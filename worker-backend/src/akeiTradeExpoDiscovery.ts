import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../../backend/src/features/discover/events/eventProviderUtils.js";
import { resolveExhibitionVenue } from "./exhibitionVenues.js";
import { delay } from "./concurrency.js";

const AKEI_BASE_URL = "https://www.akei.or.kr";
const AKEI_MONTHS_AHEAD = 3;
const AKEI_MAX_PAGES_PER_MONTH = 10;
const AKEI_FETCH_TIMEOUT_MS = 20000;
const AKEI_FETCH_RETRY_DELAY_MS = 500;
const AKEI_PAGE_DELAY_MS = 300;
const AKEI_UPSERT_BATCH_SIZE = 50;

export interface AkeiRawCandidate {
  wrId: string;
  title: string;
  organizer: string | null;
  startDate: string;
  endDate: string;
  venueText: string;
  sourceUrl: string;
}

export function parseAkeiListPage(html: string): AkeiRawCandidate[] {
  const $ = cheerio.load(html);
  const candidates: AkeiRawCandidate[] = [];

  $("li.content_sc_li").each((_, el) => {
    const $el = $(el);
    const wrId = ($el.attr("id") ?? "").replace("content_sc_", "").trim();
    if (!wrId) return;

    const $title = $el.find(".txt strong p").first().clone();
    $title.find("span").remove();
    const title = $title.text().replace(/\s+/g, " ").trim();
    if (!title) return;

    const summaryLines = $el
      .find(".txt ul li")
      .map((_, li) => $(li).text().trim())
      .get();

    const organizerLine = summaryLines.find((line) => /^주\s*최\s*:/.test(line));
    const periodLine = summaryLines.find((line) => /^기\s*간\s*:/.test(line));
    const venueLine = summaryLines.find((line) => /^장\s*소\s*:/.test(line));
    if (!periodLine || !venueLine) return;

    const periodMatch = periodLine.match(/(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/);
    if (!periodMatch) return;

    candidates.push({
      wrId,
      title,
      organizer: organizerLine ? organizerLine.replace(/^[^:]*:\s*/, "") : null,
      startDate: periodMatch[1],
      endDate: periodMatch[2],
      venueText: venueLine.replace(/^[^:]*:\s*/, ""),
      sourceUrl: `${AKEI_BASE_URL}/bbs/board.php?bo_table=schedule&wr_id=${wrId}`,
    });
  });

  return candidates;
}

export interface AkeiTradeExpoDiscoveryResult {
  processed: number;
  published: number;
  failedMonths: string[];
  unmappedVenues: number;
  failedBatches: number;
}

export const AKEI_MAX_PAGES = AKEI_MAX_PAGES_PER_MONTH;

/** 이번 회차에 훑을 월 목록. 스케줄러가 월별 1페이지 메시지를 만들 때 쓴다. */
export function akeiTargetMonths(referenceDate: Date = new Date()): { year: number; month: number }[] {
  const months: { year: number; month: number }[] = [];
  for (let offset = 0; offset < AKEI_MONTHS_AHEAD; offset++) {
    const target = new Date(
      Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth() + offset, 1),
    );
    months.push({ year: target.getUTCFullYear(), month: target.getUTCMonth() + 1 });
  }
  return months;
}

export interface AkeiTradeExpoPageResult {
  processed: number;
  published: number;
  unmappedVenues: number;
  failedBatches: number;
  failed: boolean;
  /** 이 페이지에 항목이 있어서 다음 페이지를 이어 볼 가치가 있는지. */
  hasMore: boolean;
}

/**
 * 월 하나의 페이지 하나만 처리한다. Queue 메시지 1건 = 목록 fetch 1건 +
 * upsert batch 1건이라 CPU(cheerio 파싱)와 subrequest가 모두 한 페이지분으로 묶인다.
 *
 * `akei:<wrId>` PK + `ON CONFLICT DO UPDATE`라 같은 페이지 메시지가 두 번 와도
 * 행이 중복되거나 깨지지 않는다(at-least-once 전달 안전).
 */
export async function runAkeiTradeExpoPage(
  db: D1Database,
  year: number,
  month: number,
  page: number,
): Promise<AkeiTradeExpoPageResult> {
  const monthLabel = `${year}-${String(month).padStart(2, "0")}`;
  const url = `${AKEI_BASE_URL}/bbs/board.php?bo_table=schedule&searchYear=${year}&searchMonth=${String(month).padStart(2, "0")}&page=${page}`;
  const fetched = await fetchAkeiPage(url);
  if ("error" in fetched) {
    console.error(`akei trade expo page failed month=${monthLabel} page=${page}`, fetched.error);
    return { processed: 0, published: 0, unmappedVenues: 0, failedBatches: 0, failed: true, hasMore: false };
  }

  const candidates = parseAkeiListPage(fetched.html);
  if (candidates.length === 0) {
    return { processed: 0, published: 0, unmappedVenues: 0, failedBatches: 0, failed: false, hasMore: false };
  }

  const built = buildStatements(db, candidates, new Set(), new Date().toISOString());
  const failedBatches = await upsertInBatches(db, built.statements);
  return {
    processed: built.processed,
    published: built.published,
    unmappedVenues: built.unmappedVenues,
    failedBatches,
    failed: false,
    hasMore: true,
  };
}

function buildStatements(
  db: D1Database,
  candidates: AkeiRawCandidate[],
  seenIds: Set<string>,
  scrapedAt: string,
): { statements: D1PreparedStatement[]; processed: number; published: number; unmappedVenues: number } {
  const statements: D1PreparedStatement[] = [];
  let processed = 0;
  let published = 0;
  let unmappedVenues = 0;
  for (const candidate of candidates) {
    const id = `akei:${candidate.wrId}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    processed += 1;

    const venue = resolveExhibitionVenue(candidate.venueText);
    if (!venue) {
      unmappedVenues += 1;
      console.warn(`akei trade expo unmapped venue: ${candidate.venueText}`);
      continue;
    }

    statements.push(buildUpsertStatement(db, candidate, venue, scrapedAt));
    published += 1;
  }
  return { statements, processed, published, unmappedVenues };
}

export async function runAkeiTradeExpoDiscovery(
  db: D1Database,
  referenceDate: Date = new Date(),
): Promise<AkeiTradeExpoDiscoveryResult> {
  let processed = 0;
  let published = 0;
  let unmappedVenues = 0;
  const failedMonths: string[] = [];
  const statements: D1PreparedStatement[] = [];
  const seenIds = new Set<string>();
  const scrapedAt = new Date().toISOString();

  for (let offset = 0; offset < AKEI_MONTHS_AHEAD; offset++) {
    const target = new Date(
      Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth() + offset, 1),
    );
    const year = target.getUTCFullYear();
    const month = target.getUTCMonth() + 1;
    const monthLabel = `${year}-${String(month).padStart(2, "0")}`;

    let page = 1;
    let monthFailed = false;
    while (page <= AKEI_MAX_PAGES_PER_MONTH) {
      const url = `${AKEI_BASE_URL}/bbs/board.php?bo_table=schedule&searchYear=${year}&searchMonth=${String(month).padStart(2, "0")}&page=${page}`;
      const fetched = await fetchAkeiPage(url);
      if ("error" in fetched) {
        console.error(`akei trade expo discovery failed for month=${monthLabel} page=${page}`, fetched.error);
        monthFailed = true;
        break;
      }

      const candidates = parseAkeiListPage(fetched.html);
      if (candidates.length === 0) break;

      const built = buildStatements(db, candidates, seenIds, scrapedAt);
      statements.push(...built.statements);
      processed += built.processed;
      published += built.published;
      unmappedVenues += built.unmappedVenues;

      page += 1;
      await delay(AKEI_PAGE_DELAY_MS);
    }
    if (monthFailed) failedMonths.push(monthLabel);
  }

  const failedBatches = await upsertInBatches(db, statements);

  return { processed, published, failedMonths, unmappedVenues, failedBatches };
}

// D1은 배치당 실행 가능한 statement 수에 실질적인 한계가 있어, 한 번에 전부
// batch()에 넣으면 한 청크의 실패가 이번 실행에서 성공한 나머지 행까지 전부
// 날려버린다. 청크별로 독립된 batch() 호출로 나눠 하나가 실패해도 다른
// 청크는 계속 저장되게 한다.
async function upsertInBatches(
  db: D1Database,
  statements: D1PreparedStatement[],
): Promise<number> {
  let failedBatches = 0;
  for (let start = 0; start < statements.length; start += AKEI_UPSERT_BATCH_SIZE) {
    const chunk = statements.slice(start, start + AKEI_UPSERT_BATCH_SIZE);
    try {
      await db.batch(chunk);
    } catch (error) {
      failedBatches += 1;
      console.error(
        `akei trade expo discovery batch upsert failed for chunk starting at index ${start}`,
        error,
      );
    }
  }
  return failedBatches;
}

async function fetchAkeiPage(url: string): Promise<{ html: string } | { error: Error }> {
  const attempts = 2;
  let lastError: Error = new Error("unreachable");
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchWithTimeout(
        new URL(url),
        { headers: { "User-Agent": "Mozilla/5.0 ParkingLotNavigator/1.0" } },
        AKEI_FETCH_TIMEOUT_MS,
      );
      if (!response.ok) {
        throw new Error(`akei trade expo page fetch failed: ${response.status}`);
      }
      return { html: await response.text() };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < attempts) await delay(AKEI_FETCH_RETRY_DELAY_MS);
    }
  }
  return { error: lastError };
}

function buildUpsertStatement(
  db: D1Database,
  candidate: AkeiRawCandidate,
  venue: { lat: number; lng: number; address: string },
  scrapedAt: string,
): D1PreparedStatement {
  const id = `akei:${candidate.wrId}`;
  return db
    .prepare(
      `INSERT INTO akei_trade_expos (
        id, source_url, title, organizer, start_date, end_date, venue, address, lat, lng, image_url, scraped_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_url = excluded.source_url,
        title = excluded.title,
        organizer = excluded.organizer,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        venue = excluded.venue,
        address = excluded.address,
        lat = excluded.lat,
        lng = excluded.lng,
        image_url = excluded.image_url,
        scraped_at = excluded.scraped_at`,
    )
    .bind(
      id,
      candidate.sourceUrl,
      candidate.title,
      candidate.organizer,
      candidate.startDate,
      candidate.endDate,
      candidate.venueText,
      venue.address,
      venue.lat,
      venue.lng,
      null,
      scrapedAt,
    );
}

