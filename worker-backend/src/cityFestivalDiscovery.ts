import {
  fetchWithTimeout,
  setGeocodeStore,
  KakaoEventCoordinateResolver
} from "../../backend/src/features/discover/events/eventProviderUtils.js";
import { CUSTOM_PARSERS } from "./cityFestivalParsers/customParsers/index.js";
import { parseDeclarative } from "./cityFestivalParsers/declarativeParser.js";
import type { CitySiteConfig, RawCityFestivalCandidate } from "./cityFestivalParsers/types.js";
import { CITY_FESTIVAL_SITES } from "./cityFestivalSites.js";
import { createD1GeocodeStore } from "./geocodeStore.js";
import { normalizeCandidate } from "./cityFestivalNormalize.js";
import type { NormalizedCityFestival } from "./cityFestivalNormalize.js";
import { scoreCandidate } from "./cityFestivalScore.js";
import type { Env } from "./index.js";

const CITY_FESTIVAL_INTER_SITE_DELAY_MS = 300;
const CITY_FESTIVAL_FETCH_TIMEOUT_MS = 10000;
const DEFAULT_AUTO_PUBLISH_MIN_SCORE = 0.7;
const DEFAULT_GEOCODE_MISS_BUDGET = 30;

export interface CityFestivalDiscoveryResult {
  processed: number;
  published: number;
  failedSites: string[];
}

export async function runCityFestivalDiscovery(
  db: D1Database,
  env: Env,
  sites: CitySiteConfig[] = CITY_FESTIVAL_SITES
): Promise<CityFestivalDiscoveryResult> {
  setGeocodeStore(createD1GeocodeStore(db));

  const rawThresholdInput = env.CITY_FESTIVAL_AUTO_PUBLISH_MIN_SCORE?.trim();
  const rawThreshold = rawThresholdInput ? Number(rawThresholdInput) : DEFAULT_AUTO_PUBLISH_MIN_SCORE;
  const threshold = Number.isFinite(rawThreshold) ? rawThreshold : DEFAULT_AUTO_PUBLISH_MIN_SCORE;

  const rawMissBudgetInput = env.CITY_FESTIVAL_GEOCODE_MISS_BUDGET?.trim();
  const rawMissBudget = rawMissBudgetInput ? Number(rawMissBudgetInput) : DEFAULT_GEOCODE_MISS_BUDGET;
  const missBudget = Number.isFinite(rawMissBudget) ? rawMissBudget : DEFAULT_GEOCODE_MISS_BUDGET;
  const resolver = new KakaoEventCoordinateResolver(env, { missBudget });

  let processed = 0;
  let published = 0;
  const failedSites: string[] = [];
  const statements: D1PreparedStatement[] = [];
  const htmlCache = new Map<string, { html: string } | { error: Error }>();

  for (const site of sites) {
    try {
      const candidates = await discoverSite(site, htmlCache);
      processed += candidates.length;
      await resolver.warmup(
        candidates
          .filter((c) => (c.addressRaw || c.venueRaw) && !(typeof c.lat === "number" && typeof c.lng === "number"))
          .map((c) => ({
            title: c.title ?? "",
            venue: c.venueRaw,
            address: c.addressRaw,
            region: site.cityName
          }))
      );
      for (const candidate of candidates) {
        const normalized = await normalizeCandidate(candidate, site, resolver);
        if (!normalized) continue;
        const score = scoreCandidate(normalized);
        if (score < threshold) continue;
        statements.push(buildUpsertStatement(db, normalized, score));
        published += 1;
      }
    } catch (error) {
      console.error(`city festival discovery failed for site=${site.siteId}`, error);
      failedSites.push(site.siteId);
    }
    await delay(CITY_FESTIVAL_INTER_SITE_DELAY_MS);
  }

  // Flush geocode cache writes before the festival upsert batch so a failed
  // batch (e.g. too many statements) doesn't discard Kakao lookups that
  // already cost miss budget.
  await resolver.flush();
  if (statements.length > 0) {
    await db.batch(statements);
  }

  return { processed, published, failedSites };
}

// 여러 site config가 같은 listUrl을 공유하는 경우(예: 충북 11개 시/군이 표
// 하나를 함께 씀) fetch를 중복하지 않도록 이번 discovery 실행 동안만 유효한
// listUrl 기준 캐시를 쓴다. Cloudflare Workers는 한 번의 invocation에서 보낼
// 수 있는 subrequest 개수에 한도가 있어, 같은 URL을 site 개수만큼 반복
// fetch하면 뒤에 처리되는 사이트들이 그 한도에 걸려 실패한다.
// 일부 사이트(예: tour.jb.go.kr)는 Cloudflare Workers의 fetch 서브리퀘스트
// 경로에서만 간헐적으로 AbortError나 416처럼 서로 다른 종류의 일시적 오류를
// 낸다(2026-07-30 wrangler tail로 확인: 같은 사이트가 실행마다 다른 에러로
// 실패하지만 직접 curl로는 매번 정상 응답). origin 자체가 막는 신호는 없어
// 재시도 1회로 흡수한다.
const CITY_FESTIVAL_FETCH_RETRY_DELAY_MS = 500;

async function discoverSite(
  site: CitySiteConfig,
  htmlCache: Map<string, { html: string } | { error: Error }>
): Promise<RawCityFestivalCandidate[]> {
  let entry = htmlCache.get(site.listUrl);
  if (!entry) {
    entry = await fetchSiteHtml(site);
    htmlCache.set(site.listUrl, entry);
  }
  if ("error" in entry) {
    throw entry.error;
  }
  const html = entry.html;

  if (site.customParser) {
    const parser = CUSTOM_PARSERS[site.customParser];
    if (!parser) {
      throw new Error(`no custom parser registered for customParser=${site.customParser}`);
    }
    return parser(html, site);
  }
  return parseDeclarative(html, site);
}

async function fetchSiteHtml(site: CitySiteConfig): Promise<{ html: string } | { error: Error }> {
  const attempts = 2;
  let lastError: Error = new Error("unreachable");
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchWithTimeout(
        new URL(site.listUrl),
        {
          method: site.fetchMethod ?? "GET",
          headers: {
            "User-Agent": "Mozilla/5.0 ParkingLotNavigator/1.0",
            ...(site.fetchMethod === "POST"
              ? { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }
              : {}),
            ...(site.fetchReferer ? { Referer: site.fetchReferer } : {})
          },
          ...(site.fetchBody ? { body: site.fetchBody } : {})
        },
        CITY_FESTIVAL_FETCH_TIMEOUT_MS
      );
      if (!response.ok) {
        throw new Error(`city festival site fetch failed: ${response.status}`);
      }
      return { html: await response.text() };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < attempts) await delay(CITY_FESTIVAL_FETCH_RETRY_DELAY_MS);
    }
  }
  return { error: lastError };
}

function buildUpsertStatement(
  db: D1Database,
  normalized: NormalizedCityFestival,
  score: number
): D1PreparedStatement {
  const id = buildCityFestivalId(normalized.siteId, normalized.title, normalized.startDate);
  const scrapedAt = new Date().toISOString();
  return db
    .prepare(
      `INSERT INTO city_festivals (
        id, site_id, source_url, title, start_date, end_date, venue, address, lat, lng, image_url, score, scraped_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_url = excluded.source_url,
        title = excluded.title,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        venue = excluded.venue,
        address = excluded.address,
        lat = excluded.lat,
        lng = excluded.lng,
        image_url = excluded.image_url,
        score = excluded.score,
        scraped_at = excluded.scraped_at`
    )
    .bind(
      id,
      normalized.siteId,
      normalized.sourceUrl,
      normalized.title,
      normalized.startDate,
      normalized.endDate,
      normalized.venue,
      normalized.address,
      normalized.lat,
      normalized.lng,
      normalized.imageUrl,
      score,
      scrapedAt
    );
}

function buildCityFestivalId(siteId: string, title: string, startDate: string): string {
  const normalizedTitle = title
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
  const raw = `${siteId}:${normalizedTitle}:${startDate}`;
  return `city:${djb2(raw)}`;
}

function djb2(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
