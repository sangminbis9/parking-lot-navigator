import {
  KakaoEventCoordinateResolver,
  REGION_FALLBACK_COORDINATES,
  setGeocodeStore
} from "../../backend/src/features/discover/events/eventProviderUtils.js";
import { CITY_FESTIVAL_SITES } from "./cityFestivalSites.js";
import { createD1GeocodeStore } from "./geocodeStore.js";

// 시/군 게시판 스크래핑은 장소 문구가 있어도 Kakao 조회에 실패하면 그 사이트의
// 시청 좌표(fallbackLat/fallbackLng)로 떨어진다. 실측(2026-08-14) 결과 950건 중
// 564건이 fallback 좌표 위에 겹쳐 있었고, 그중 217건은 지오코딩할 장소 문구를
// 가지고 있었다. 수집 cron은 회차당 CITY_FESTIVAL_GEOCODE_MISS_BUDGET(15)만
// 쓰므로 이 적체를 따라잡지 못한다. 그래서 요금 backfill과 같은 방식으로,
// fallback 위에 남은 행만 골라 회차당 조금씩 다시 지오코딩한다.
//
// 한 번 시도한 행은 geocode_checked_at으로 표시해 매번 같은 행에 예산을 쓰지
// 않는다. 예산이 없어 시도조차 못한 행은 표시하지 않고 다음 회차로 넘긴다.

// invocation당 subrequest 예산이 50이고 이 작업은 태깅 cron에 얹혀 돌기 때문에
// 여유를 두고 25로 잡는다. 캐시에 이미 있는 질의는 이 예산을 쓰지 않는다.
const DEFAULT_MAX_LOOKUPS = 25;
// 좌표가 사이트 fallback과 같은지 판정하는 허용 오차(약 50m). 저장 시 반올림이
// 끼어도 같은 점으로 보이게 한다.
const FALLBACK_EPSILON_DEGREES = 0.0005;
// Kakao 조회 한 건이 후보 질의 여러 개를 소모할 수 있어, 예산보다 넉넉히 읽어
// 두고 예산이 떨어지면 루프를 끊는다.
const CANDIDATE_ROW_MULTIPLIER = 4;
// discovery_items에도 같은 적체가 있다. KOPIS는 공연장 좌표를 주지 않아 3638행이
// 전부 지역 대표 좌표 위에 있고(그중 1609건이 서울시청), isRegionFallbackCoordinate가
// 이를 응답에서 걸러내 /api/performances가 늘 비어 나갔다. 시/군 축제 backfill과
// 같은 resolver·예산을 나눠 쓴다 — 시/군 적체가 소진되면 남은 예산이 전부 이쪽으로 온다.
const DISCOVERY_FALLBACK_EPSILON_DEGREES = 1e-7;
// 공연장 이름만으로 전국을 검색하면 "시민회관"처럼 흔한 이름이 엉뚱한 도시로 붙는다.
// 원래 행이 올라가 있던 지역 대표 좌표에서 이만큼 벗어나면 잘못 붙은 것으로 보고 버린다.
const MAX_REGION_DRIFT_METERS = 80_000;
// 이 계정의 Worker는 invocation당 CPU 한도가 좁아 태깅과 같은 cron에 얹힌 이 회차가
// 중간에 "Exceeded CPU Limit"으로 죽는다. 문장을 전부 모아 마지막에 한 번만 batch하면
// 그때까지 쓴 Kakao 호출이 통째로 날아가므로, 이만큼 쌓일 때마다 나눠 쓴다.
const DISCOVERY_FLUSH_SIZE = 5;

interface DiscoveryGeocodeRow {
  id: string;
  title: string;
  venue_name: string | null;
  address: string | null;
  lat: number;
  lng: number;
}

interface CityFestivalGeocodeRow {
  id: string;
  site_id: string;
  title: string;
  venue: string | null;
  address: string | null;
  lat: number;
  lng: number;
}

export interface DiscoveryGeocodeBackfillResult {
  scanned: number;
  updated: number;
  unresolved: number;
  driftRejected: number;
}

export interface GeocodeBackfillResult {
  scanned: number;
  updated: number;
  unresolved: number;
  skippedAlreadyPrecise: number;
  budgetExhausted: boolean;
  discovery: DiscoveryGeocodeBackfillResult;
}

export interface GeocodeBackfillEnv {
  KAKAO_REST_API_KEY?: string;
  KAKAO_LOCAL_BASE_URL: string;
  PARKING_PROVIDER_MODE: "mock" | "real" | "hybrid";
  GEOCODE_BACKFILL_MAX_LOOKUPS?: string;
}

export async function runGeocodeBackfill(
  db: D1Database,
  env: GeocodeBackfillEnv,
  options: { maxLookups?: number } = {}
): Promise<GeocodeBackfillResult> {
  const maxLookups = options.maxLookups ?? maxLookupsFromEnv(env);
  const result: GeocodeBackfillResult = {
    scanned: 0,
    updated: 0,
    unresolved: 0,
    skippedAlreadyPrecise: 0,
    budgetExhausted: false,
    discovery: { scanned: 0, updated: 0, unresolved: 0, driftRejected: 0 }
  };
  if (!env.KAKAO_REST_API_KEY || env.PARKING_PROVIDER_MODE === "mock") return result;

  setGeocodeStore(createD1GeocodeStore(db));
  // 두 적체가 하나의 예산을 나눠 쓴다. 시/군 축제를 먼저 돌리고 남은 예산으로
  // discovery_items를 돌려, 시/군 적체가 소진되면 예산이 전부 이쪽으로 넘어간다.
  const resolver = new KakaoEventCoordinateResolver(env, { missBudget: maxLookups });
  await backfillCityFestivals(db, resolver, maxLookups, result);
  await backfillDiscoveryItems(db, resolver, maxLookups, result);
  await resolver.flush();
  return result;
}

async function backfillCityFestivals(
  db: D1Database,
  resolver: KakaoEventCoordinateResolver,
  maxLookups: number,
  result: GeocodeBackfillResult
): Promise<void> {
  const rows = await db
    .prepare(
      `SELECT id, site_id, title, venue, address, lat, lng
         FROM city_festivals
        WHERE geocode_checked_at IS NULL
          AND (COALESCE(venue, '') <> '' OR COALESCE(address, '') <> '')
          AND end_date >= date('now')
        ORDER BY start_date ASC
        LIMIT ?`
    )
    .bind(maxLookups * CANDIDATE_ROW_MULTIPLIER)
    .all<CityFestivalGeocodeRow>();
  const candidates = rows.results ?? [];
  if (candidates.length === 0) return;

  const sites = new Map(
    CITY_FESTIVAL_SITES.map((site) => [
      site.siteId,
      { lat: site.fallbackLat, lng: site.fallbackLng, region: site.cityName }
    ])
  );
  const targets = candidates.filter((row) => {
    const site = sites.get(row.site_id);
    return site !== undefined && isFallbackCoordinate(row, site);
  });
  result.skippedAlreadyPrecise = candidates.length - targets.length;

  await resolver.warmup(
    targets.map((row) => ({
      title: row.title,
      venue: row.venue,
      address: row.address,
      region: sites.get(row.site_id)?.region ?? null
    }))
  );

  const checkedAt = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  // 이미 지오코딩된 행은 조회 없이 표시만 해서 다음 회차 후보에서 빠지게 한다.
  for (const row of candidates) {
    if (!targets.includes(row)) statements.push(markChecked(db, row.id, checkedAt));
  }

  for (const row of targets) {
    if (resolver.remainingMissBudget() <= 0) {
      result.budgetExhausted = true;
      break;
    }
    result.scanned += 1;
    let resolved: { lat: number; lng: number } | null = null;
    try {
      resolved = await resolver.resolve({
        title: row.title,
        venue: row.venue,
        address: row.address,
        region: sites.get(row.site_id)?.region ?? null
      });
    } catch {
      // 일시적 실패는 표시하지 않고 다음 회차에 다시 시도한다.
      continue;
    }
    if (resolved) {
      result.updated += 1;
      statements.push(
        db
          .prepare(
            `UPDATE city_festivals
                SET lat = ?, lng = ?, geocode_checked_at = ?
              WHERE id = ?`
          )
          .bind(resolved.lat, resolved.lng, checkedAt, row.id)
      );
    } else {
      result.unresolved += 1;
      statements.push(markChecked(db, row.id, checkedAt));
    }
  }

  if (statements.length > 0) await db.batch(statements);
}

async function backfillDiscoveryItems(
  db: D1Database,
  resolver: KakaoEventCoordinateResolver,
  maxLookups: number,
  result: GeocodeBackfillResult
): Promise<void> {
  if (resolver.remainingMissBudget() <= 0) {
    result.budgetExhausted = true;
    return;
  }

  const fallbackMatch = REGION_FALLBACK_COORDINATES.map(
    () => "(ABS(lat - ?) < ? AND ABS(lng - ?) < ?)"
  ).join(" OR ");
  const fallbackBindings = REGION_FALLBACK_COORDINATES.flatMap((coordinate) => [
    coordinate.lat,
    DISCOVERY_FALLBACK_EPSILON_DEGREES,
    coordinate.lng,
    DISCOVERY_FALLBACK_EPSILON_DEGREES
  ]);
  const rows = await db
    .prepare(
      `SELECT id, title, venue_name, address, lat, lng
         FROM discovery_items
        WHERE geocode_checked_at IS NULL
          AND COALESCE(venue_name, '') <> ''
          AND end_date >= date('now')
          AND (${fallbackMatch})
        ORDER BY start_date ASC
        LIMIT ?`
    )
    .bind(...fallbackBindings, maxLookups * CANDIDATE_ROW_MULTIPLIER)
    .all<DiscoveryGeocodeRow>();
  const targets = rows.results ?? [];
  if (targets.length === 0) return;

  await resolver.warmup(
    targets.map((row) => ({
      title: row.title,
      venue: row.venue_name,
      address: row.address,
      region: null
    }))
  );

  const checkedAt = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const row of targets) {
    if (statements.length >= DISCOVERY_FLUSH_SIZE) {
      await db.batch(statements.splice(0));
    }
    if (resolver.remainingMissBudget() <= 0) {
      result.budgetExhausted = true;
      break;
    }
    result.discovery.scanned += 1;
    let resolved: { lat: number; lng: number } | null = null;
    try {
      resolved = await resolver.resolve({
        title: row.title,
        venue: row.venue_name,
        address: row.address,
        region: null
      });
    } catch {
      continue;
    }
    if (resolved && driftMeters(row, resolved) > MAX_REGION_DRIFT_METERS) {
      // 지역이 다른 동명 시설로 붙은 결과다. 원래 fallback 좌표를 그대로 두고
      // 시도했다고만 표시한다.
      result.discovery.driftRejected += 1;
      statements.push(markDiscoveryChecked(db, row.id, checkedAt));
      continue;
    }
    if (resolved) {
      result.discovery.updated += 1;
      statements.push(
        db
          .prepare(
            `UPDATE discovery_items
                SET lat = ?, lng = ?, geocode_checked_at = ?
              WHERE id = ?`
          )
          .bind(resolved.lat, resolved.lng, checkedAt, row.id)
      );
    } else {
      result.discovery.unresolved += 1;
      statements.push(markDiscoveryChecked(db, row.id, checkedAt));
    }
  }

  if (statements.length > 0) await db.batch(statements);
}

function markDiscoveryChecked(
  db: D1Database,
  id: string,
  checkedAt: string
): D1PreparedStatement {
  return db
    .prepare(`UPDATE discovery_items SET geocode_checked_at = ? WHERE id = ?`)
    .bind(checkedAt, id);
}

// 위경도 차이를 거리로 바꾼다. 한국 위도대에서 오차가 작고 계산이 싸다.
function driftMeters(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): number {
  const latMeters = (to.lat - from.lat) * 111_320;
  const lngMeters = (to.lng - from.lng) * 111_320 * Math.cos((from.lat * Math.PI) / 180);
  return Math.hypot(latMeters, lngMeters);
}

function markChecked(db: D1Database, id: string, checkedAt: string): D1PreparedStatement {
  return db
    .prepare(`UPDATE city_festivals SET geocode_checked_at = ? WHERE id = ?`)
    .bind(checkedAt, id);
}

function isFallbackCoordinate(
  row: CityFestivalGeocodeRow,
  site: { lat: number; lng: number }
): boolean {
  return (
    Math.abs(row.lat - site.lat) < FALLBACK_EPSILON_DEGREES &&
    Math.abs(row.lng - site.lng) < FALLBACK_EPSILON_DEGREES
  );
}

function maxLookupsFromEnv(env: GeocodeBackfillEnv): number {
  const raw = env.GEOCODE_BACKFILL_MAX_LOOKUPS?.trim();
  const parsed = raw ? Number(raw) : DEFAULT_MAX_LOOKUPS;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_LOOKUPS;
}
