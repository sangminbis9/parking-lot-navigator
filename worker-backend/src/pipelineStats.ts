import { REGION_FALLBACK_COORDINATES } from "../../backend/src/features/discover/events/eventProviderUtils.js";
import { IMAGE_SOURCE_KINDS } from "./imageBackfill.js";

// "개발자" 대시보드가 보여줄 수집 파이프라인 현황. 각 테이블의 현재 스냅샷과
// 최근 유입·처리 큐 상태를 집계한다. 파이프라인별 실행 이력은 sync_runs
// (discovery 청크 sync만 기록) 외에는 D1에 남아있지 않아 여기서도 만들어내지 않는다.

interface CountRow {
  key: string | null;
  count: number;
}

interface SyncRunRow {
  id: string;
  syncType: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  fetched: number;
  upserted: number;
  skipped: number;
  pruned: number;
  message: string | null;
}

interface SyncTypeRow {
  syncType: string;
  runs: number;
  success: number;
  failed: number;
  timeout: number;
  fetched: number;
  upserted: number;
  pruned: number;
  lastStartedAt: string | null;
}

export interface PipelineStats {
  generatedAt: string;
  discoveryItems: {
    total: number;
    byType: { type: string; count: number }[];
    bySource: { source: string; count: number }[];
    byStatus: { status: string; count: number }[];
    byPrimaryCategory: { category: string; count: number }[];
    taggingCoverage: { tagged: number; total: number };
    feeCoverage: { free: number; paid: number; unknown: number; unchecked: number };
    ingestion: {
      newLast24h: number;
      newLast7d: number;
      refreshedLast24h: number;
      // 이미 끝난 행사는 원본 API에서 사라져 last_seen_at이 영원히 안 오르므로
      // staleOver7d(아직 안 끝난 것)와 staleEndedOver7d(끝난 것)를 나눠 센다.
      staleOver7d: number;
      staleEndedOver7d: number;
      missingCoordinates: number;
      latestFirstSeenAt: string | null;
      latestSyncedAt: string | null;
      dailyNew: { date: string; count: number }[];
      newBySourceLast7d: { source: string; count: number }[];
    };
    tagging: {
      llmTagged: number;
      fallbackTagged: number;
      pending: number;
      oldestPendingFirstSeenAt: string | null;
      lastTaggedAt: string | null;
      byModel: { model: string; count: number }[];
    };
    fee: {
      oldestUncheckedFirstSeenAt: string | null;
      lastCheckedAt: string | null;
      checkedLast24h: number;
    };
    // backfill 회차가 조용히 죽어도 남은 잔량은 계속 그대로다. 잔량과 마지막
    // 실행 시각을 함께 내려, 대시보드에서 "며칠째 안 줄었다"가 바로 보이게 한다.
    // 요금 잔량은 feeCoverage.unchecked / fee.lastCheckedAt이 이미 같은 역할을 한다.
    backfill: {
      geocodePending: number;
      geocodeLastCheckedAt: string | null;
      geocodeCheckedLast24h: number;
      imagePending: number;
      imageLastCheckedAt: string | null;
      imageCheckedLast24h: number;
    };
  };
  localEvents: {
    total: number;
    byStatus: { status: string; count: number }[];
    bySource: { source: string; count: number }[];
    byEventType: { eventType: string; count: number }[];
    needsReview: number;
    taggingCoverage: { tagged: number; total: number };
    ingestion: {
      newLast24h: number;
      newLast7d: number;
      approvedLast7d: number;
      averageConfidence: number | null;
      oldestPendingCreatedAt: string | null;
      latestCreatedAt: string | null;
      dailyNew: { date: string; count: number }[];
    };
  };
  cityFestivals: {
    total: number;
    geocodeChecked: number;
    geocodeUnchecked: number;
    upcoming: number;
    ended: number;
    scrapedLast24h: number;
    lastScrapedAt: string | null;
  };
  akeiTradeExpos: {
    total: number;
    upcoming: number;
    scrapedLast24h: number;
    lastScrapedAt: string | null;
  };
  syncActivity: {
    running: number;
    last24h: {
      runs: number;
      success: number;
      failed: number;
      timeout: number;
      fetched: number;
      upserted: number;
      skipped: number;
      pruned: number;
    };
    byType: SyncTypeRow[];
    lastSuccessAt: string | null;
  };
  recentSyncRuns: SyncRunRow[];
}

/// D1 컬럼은 `2026-08-15T01:02:03.000Z` 형태의 ISO 문자열이라 SQLite 기본
/// `datetime()`(공백 구분자) 결과와 문자열 비교가 어긋난다. 같은 모양으로 만들어 비교한다.
function isoAgo(offset: string): string {
  return `strftime('%Y-%m-%dT%H:%M:%fZ','now','${offset}')`;
}

export interface PipelineStatsOptions {
  // sync_runs.message에는 provider 예외 문자열이 그대로 들어간다. 관리자 토큰
  // 없이 부르는 앱 대시보드에는 내려주지 않는다.
  includeRunMessages?: boolean;
}

// 대시보드가 짧은 간격으로 pull-to-refresh/폴링하면 매번 discovery_items/
// local_events/sync_runs를 훑는 이 함수가 그대로 곱해진다. isolate 수명 동안만
// 유지되는 캐시라 정확한 TTL 보장은 아니지만, 반복 호출 비용을 크게 줄인다.
const STATS_CACHE_TTL_MS = 60_000;
let statsCache: { includeRunMessages: boolean; expiresAt: number; stats: PipelineStats } | null = null;

export async function queryPipelineStats(
  db: D1Database,
  options: PipelineStatsOptions = {},
): Promise<PipelineStats> {
  const includeRunMessages = options.includeRunMessages === true;
  const now = Date.now();
  if (statsCache && statsCache.includeRunMessages === includeRunMessages && statsCache.expiresAt > now) {
    return statsCache.stats;
  }
  const stats = await computePipelineStats(db, options);
  statsCache = { includeRunMessages, expiresAt: now + STATS_CACHE_TTL_MS, stats };
  return stats;
}

async function computePipelineStats(
  db: D1Database,
  options: PipelineStatsOptions = {},
): Promise<PipelineStats> {
  const [
    discoveryTotal,
    discoveryByType,
    discoveryBySource,
    discoveryByStatus,
    discoveryByCategory,
    discoveryTagged,
    discoveryFee,
    discoveryIngest,
    discoveryDailyNew,
    discoveryNewBySource,
    discoveryTagging,
    discoveryTaggingAges,
    discoveryTaggingModels,
    discoveryFeeAges,
  ] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT COUNT(*) AS count FROM discovery_items`),
    db.prepare(`SELECT type AS key, COUNT(*) AS count FROM discovery_items GROUP BY type`),
    db.prepare(`SELECT source AS key, COUNT(*) AS count FROM discovery_items GROUP BY source ORDER BY count DESC`),
    db.prepare(`SELECT COALESCE(status, 'unknown') AS key, COUNT(*) AS count FROM discovery_items GROUP BY 1 ORDER BY count DESC`),
    db.prepare(
      `SELECT COALESCE(primary_category, 'untagged') AS key, COUNT(*) AS count
         FROM discovery_items GROUP BY 1 ORDER BY count DESC`
    ),
    db.prepare(`SELECT COUNT(*) AS count FROM discovery_items WHERE tagging_version > 0`),
    db.prepare(
      `SELECT
         SUM(CASE WHEN is_free = 1 THEN 1 ELSE 0 END) AS free,
         SUM(CASE WHEN is_free = 0 THEN 1 ELSE 0 END) AS paid,
         SUM(CASE WHEN is_free IS NULL AND fee_checked_at IS NOT NULL THEN 1 ELSE 0 END) AS unknown,
         SUM(CASE WHEN fee_checked_at IS NULL THEN 1 ELSE 0 END) AS unchecked
       FROM discovery_items`
    ),
    db.prepare(
      `SELECT
         SUM(CASE WHEN first_seen_at >= ${isoAgo("-1 day")} THEN 1 ELSE 0 END) AS newLast24h,
         SUM(CASE WHEN first_seen_at >= ${isoAgo("-7 days")} THEN 1 ELSE 0 END) AS newLast7d,
         SUM(CASE WHEN last_seen_at >= ${isoAgo("-1 day")} THEN 1 ELSE 0 END) AS refreshedLast24h,
         SUM(CASE WHEN last_seen_at < ${isoAgo("-7 days")}
                   AND (end_date IS NULL OR end_date >= date('now'))
                  THEN 1 ELSE 0 END) AS staleOver7d,
         SUM(CASE WHEN last_seen_at < ${isoAgo("-7 days")}
                   AND end_date < date('now')
                  THEN 1 ELSE 0 END) AS staleEndedOver7d,
         SUM(CASE WHEN lat = 0 OR lng = 0 THEN 1 ELSE 0 END) AS missingCoordinates,
         MAX(first_seen_at) AS latestFirstSeenAt,
         MAX(synced_at) AS latestSyncedAt
       FROM discovery_items`
    ),
    db.prepare(
      `SELECT substr(first_seen_at, 1, 10) AS key, COUNT(*) AS count
         FROM discovery_items
        WHERE first_seen_at >= ${isoAgo("-7 days")}
        GROUP BY 1 ORDER BY 1`
    ),
    db.prepare(
      `SELECT source AS key, COUNT(*) AS count
         FROM discovery_items
        WHERE first_seen_at >= ${isoAgo("-7 days")}
        GROUP BY 1 ORDER BY count DESC LIMIT 12`
    ),
    db.prepare(
      `SELECT
         SUM(CASE WHEN tagging_version > 0 THEN 1 ELSE 0 END) AS llmTagged,
         SUM(CASE WHEN tagging_version = -1 THEN 1 ELSE 0 END) AS fallbackTagged,
         SUM(CASE WHEN tagging_version = 0 THEN 1 ELSE 0 END) AS pending
       FROM discovery_items`
    ),
    db.prepare(
      `SELECT
         (SELECT MIN(first_seen_at) FROM discovery_items WHERE tagging_version = 0) AS oldestPendingFirstSeenAt,
         (SELECT MAX(tagged_at) FROM discovery_items) AS lastTaggedAt`
    ),
    db.prepare(
      `SELECT tagging_model AS key, COUNT(*) AS count
         FROM discovery_items
        WHERE tagging_model IS NOT NULL
        GROUP BY 1 ORDER BY count DESC LIMIT 6`
    ),
    db.prepare(
      `SELECT
         (SELECT MIN(first_seen_at) FROM discovery_items WHERE fee_checked_at IS NULL) AS oldestUncheckedFirstSeenAt,
         (SELECT MAX(fee_checked_at) FROM discovery_items) AS lastCheckedAt,
         (SELECT COUNT(*) FROM discovery_items WHERE fee_checked_at >= ${isoAgo("-1 day")}) AS checkedLast24h`
    ),
  ]);

  const [
    localTotal,
    localByStatus,
    localBySource,
    localByEventType,
    localNeedsReview,
    localTagged,
    localIngest,
    localDailyNew,
    discoveryBackfill,
    cityStats,
    akeiStats,
    syncRunning,
    syncLast24h,
    syncByType,
    syncLastSuccess,
    recentSyncRuns,
  ] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT COUNT(*) AS count FROM local_events`),
    db.prepare(`SELECT status AS key, COUNT(*) AS count FROM local_events GROUP BY status`),
    db.prepare(`SELECT source AS key, COUNT(*) AS count FROM local_events GROUP BY source ORDER BY count DESC`),
    db.prepare(`SELECT event_type AS key, COUNT(*) AS count FROM local_events GROUP BY event_type ORDER BY count DESC`),
    db.prepare(`SELECT COUNT(*) AS count FROM local_events WHERE needs_review = 1`),
    db.prepare(`SELECT COUNT(*) AS count FROM local_events WHERE tagging_version > 0`),
    db.prepare(
      `SELECT
         SUM(CASE WHEN created_at >= ${isoAgo("-1 day")} THEN 1 ELSE 0 END) AS newLast24h,
         SUM(CASE WHEN created_at >= ${isoAgo("-7 days")} THEN 1 ELSE 0 END) AS newLast7d,
         SUM(CASE WHEN approved_at >= ${isoAgo("-7 days")} THEN 1 ELSE 0 END) AS approvedLast7d,
         AVG(confidence_score) AS averageConfidence,
         MAX(created_at) AS latestCreatedAt,
         (SELECT MIN(created_at) FROM local_events WHERE status = 'pending') AS oldestPendingCreatedAt
       FROM local_events`
    ),
    db.prepare(
      `SELECT substr(created_at, 1, 10) AS key, COUNT(*) AS count
         FROM local_events
        WHERE created_at >= ${isoAgo("-7 days")}
        GROUP BY 1 ORDER BY 1`
    ),
    db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM discovery_items
           WHERE geocode_checked_at IS NULL
             AND COALESCE(venue_name, '') <> ''
             AND end_date >= date('now')
             AND (${discoveryFallbackCoordinateMatch()})) AS geocodePending,
         (SELECT MAX(geocode_checked_at) FROM discovery_items) AS geocodeLastCheckedAt,
         (SELECT COUNT(*) FROM discovery_items
           WHERE geocode_checked_at >= ${isoAgo("-1 day")}) AS geocodeCheckedLast24h,
         (SELECT COUNT(*) FROM discovery_items
           WHERE images_checked_at IS NULL
             AND source IN (${imageBackfillSourceList()})
             AND (end_date IS NULL OR end_date >= date('now'))) AS imagePending,
         (SELECT MAX(images_checked_at) FROM discovery_items) AS imageLastCheckedAt,
         (SELECT COUNT(*) FROM discovery_items
           WHERE images_checked_at >= ${isoAgo("-1 day")}) AS imageCheckedLast24h`
    ),
    db.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN geocode_checked_at IS NOT NULL THEN 1 ELSE 0 END) AS geocodeChecked,
         SUM(CASE WHEN end_date >= date('now') THEN 1 ELSE 0 END) AS upcoming,
         SUM(CASE WHEN scraped_at >= ${isoAgo("-1 day")} THEN 1 ELSE 0 END) AS scrapedLast24h,
         MAX(scraped_at) AS lastScrapedAt
       FROM city_festivals`
    ),
    db.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN end_date >= date('now') THEN 1 ELSE 0 END) AS upcoming,
         SUM(CASE WHEN scraped_at >= ${isoAgo("-1 day")} THEN 1 ELSE 0 END) AS scrapedLast24h,
         MAX(scraped_at) AS lastScrapedAt
       FROM akei_trade_expos`
    ),
    db.prepare(`SELECT COUNT(*) AS count FROM sync_runs WHERE status = 'running'`),
    db.prepare(
      `SELECT
         COUNT(*) AS runs,
         SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN status = 'timeout' THEN 1 ELSE 0 END) AS timeout,
         SUM(fetched) AS fetched,
         SUM(upserted) AS upserted,
         SUM(skipped) AS skipped,
         SUM(pruned) AS pruned
       FROM sync_runs
        WHERE started_at >= ${isoAgo("-1 day")}`
    ),
    db.prepare(
      `SELECT
         sync_type AS syncType,
         COUNT(*) AS runs,
         SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN status = 'timeout' THEN 1 ELSE 0 END) AS timeout,
         SUM(fetched) AS fetched,
         SUM(upserted) AS upserted,
         SUM(pruned) AS pruned,
         MAX(started_at) AS lastStartedAt
       FROM sync_runs
        WHERE started_at >= ${isoAgo("-1 day")}
        GROUP BY sync_type
        ORDER BY runs DESC, syncType
        LIMIT 20`
    ),
    db.prepare(`SELECT MAX(started_at) AS value FROM sync_runs WHERE status = 'success'`),
    db.prepare(
      `SELECT id,
              sync_type AS syncType,
              started_at AS startedAt,
              finished_at AS finishedAt,
              status, fetched, upserted, skipped, pruned, message
         FROM sync_runs
        ORDER BY started_at DESC
        LIMIT 15`
    ),
  ]);

  const cityTotalCount = firstNumber(cityStats, "total");
  const cityGeocodeChecked = firstNumber(cityStats, "geocodeChecked");
  const cityUpcoming = firstNumber(cityStats, "upcoming");

  return {
    generatedAt: new Date().toISOString(),
    discoveryItems: {
      total: firstCount(discoveryTotal),
      byType: toCountList(discoveryByType),
      bySource: toCountList(discoveryBySource).map((row) => ({ source: row.type, count: row.count })),
      byStatus: toCountList(discoveryByStatus).map((row) => ({ status: row.type, count: row.count })),
      byPrimaryCategory: toCountList(discoveryByCategory).map((row) => ({
        category: row.type,
        count: row.count,
      })),
      taggingCoverage: { tagged: firstCount(discoveryTagged), total: firstCount(discoveryTotal) },
      feeCoverage: {
        free: firstNumber(discoveryFee, "free"),
        paid: firstNumber(discoveryFee, "paid"),
        unknown: firstNumber(discoveryFee, "unknown"),
        unchecked: firstNumber(discoveryFee, "unchecked"),
      },
      ingestion: {
        newLast24h: firstNumber(discoveryIngest, "newLast24h"),
        newLast7d: firstNumber(discoveryIngest, "newLast7d"),
        refreshedLast24h: firstNumber(discoveryIngest, "refreshedLast24h"),
        staleOver7d: firstNumber(discoveryIngest, "staleOver7d"),
        staleEndedOver7d: firstNumber(discoveryIngest, "staleEndedOver7d"),
        missingCoordinates: firstNumber(discoveryIngest, "missingCoordinates"),
        latestFirstSeenAt: firstText(discoveryIngest, "latestFirstSeenAt"),
        latestSyncedAt: firstText(discoveryIngest, "latestSyncedAt"),
        dailyNew: toCountList(discoveryDailyNew).map((row) => ({ date: row.type, count: row.count })),
        newBySourceLast7d: toCountList(discoveryNewBySource).map((row) => ({
          source: row.type,
          count: row.count,
        })),
      },
      tagging: {
        llmTagged: firstNumber(discoveryTagging, "llmTagged"),
        fallbackTagged: firstNumber(discoveryTagging, "fallbackTagged"),
        pending: firstNumber(discoveryTagging, "pending"),
        oldestPendingFirstSeenAt: firstText(discoveryTaggingAges, "oldestPendingFirstSeenAt"),
        lastTaggedAt: firstText(discoveryTaggingAges, "lastTaggedAt"),
        byModel: toCountList(discoveryTaggingModels).map((row) => ({ model: row.type, count: row.count })),
      },
      fee: {
        oldestUncheckedFirstSeenAt: firstText(discoveryFeeAges, "oldestUncheckedFirstSeenAt"),
        lastCheckedAt: firstText(discoveryFeeAges, "lastCheckedAt"),
        checkedLast24h: firstNumber(discoveryFeeAges, "checkedLast24h"),
      },
      backfill: {
        geocodePending: firstNumber(discoveryBackfill, "geocodePending"),
        geocodeLastCheckedAt: firstText(discoveryBackfill, "geocodeLastCheckedAt"),
        geocodeCheckedLast24h: firstNumber(discoveryBackfill, "geocodeCheckedLast24h"),
        imagePending: firstNumber(discoveryBackfill, "imagePending"),
        imageLastCheckedAt: firstText(discoveryBackfill, "imageLastCheckedAt"),
        imageCheckedLast24h: firstNumber(discoveryBackfill, "imageCheckedLast24h"),
      },
    },
    localEvents: {
      total: firstCount(localTotal),
      byStatus: toCountList(localByStatus).map((row) => ({ status: row.type, count: row.count })),
      bySource: toCountList(localBySource).map((row) => ({ source: row.type, count: row.count })),
      byEventType: toCountList(localByEventType).map((row) => ({ eventType: row.type, count: row.count })),
      needsReview: firstCount(localNeedsReview),
      taggingCoverage: { tagged: firstCount(localTagged), total: firstCount(localTotal) },
      ingestion: {
        newLast24h: firstNumber(localIngest, "newLast24h"),
        newLast7d: firstNumber(localIngest, "newLast7d"),
        approvedLast7d: firstNumber(localIngest, "approvedLast7d"),
        averageConfidence: firstOptionalNumber(localIngest, "averageConfidence"),
        oldestPendingCreatedAt: firstText(localIngest, "oldestPendingCreatedAt"),
        latestCreatedAt: firstText(localIngest, "latestCreatedAt"),
        dailyNew: toCountList(localDailyNew).map((row) => ({ date: row.type, count: row.count })),
      },
    },
    cityFestivals: {
      total: cityTotalCount,
      geocodeChecked: cityGeocodeChecked,
      geocodeUnchecked: cityTotalCount - cityGeocodeChecked,
      upcoming: cityUpcoming,
      ended: cityTotalCount - cityUpcoming,
      scrapedLast24h: firstNumber(cityStats, "scrapedLast24h"),
      lastScrapedAt: firstText(cityStats, "lastScrapedAt"),
    },
    akeiTradeExpos: {
      total: firstNumber(akeiStats, "total"),
      upcoming: firstNumber(akeiStats, "upcoming"),
      scrapedLast24h: firstNumber(akeiStats, "scrapedLast24h"),
      lastScrapedAt: firstText(akeiStats, "lastScrapedAt"),
    },
    syncActivity: {
      running: firstCount(syncRunning),
      last24h: {
        runs: firstNumber(syncLast24h, "runs"),
        success: firstNumber(syncLast24h, "success"),
        failed: firstNumber(syncLast24h, "failed"),
        timeout: firstNumber(syncLast24h, "timeout"),
        fetched: firstNumber(syncLast24h, "fetched"),
        upserted: firstNumber(syncLast24h, "upserted"),
        skipped: firstNumber(syncLast24h, "skipped"),
        pruned: firstNumber(syncLast24h, "pruned"),
      },
      byType: ((syncByType.results ?? []) as unknown as SyncTypeRow[]).map((row) => ({
        syncType: row.syncType,
        runs: Number(row.runs ?? 0),
        success: Number(row.success ?? 0),
        failed: Number(row.failed ?? 0),
        timeout: Number(row.timeout ?? 0),
        fetched: Number(row.fetched ?? 0),
        upserted: Number(row.upserted ?? 0),
        pruned: Number(row.pruned ?? 0),
        lastStartedAt: row.lastStartedAt ?? null,
      })),
      lastSuccessAt: firstText(syncLastSuccess, "value"),
    },
    recentSyncRuns: ((recentSyncRuns.results ?? []) as unknown as SyncRunRow[]).map(
      (run) =>
        options.includeRunMessages ? run : { ...run, message: null },
    ),
  };
}

function firstCount(result: D1Result<Record<string, unknown>>): number {
  return Number(result.results?.[0]?.count ?? 0);
}

function firstNumber(result: D1Result<Record<string, unknown>>, key: string): number {
  return Number(result.results?.[0]?.[key] ?? 0);
}

function firstOptionalNumber(
  result: D1Result<Record<string, unknown>>,
  key: string
): number | null {
  const value = result.results?.[0]?.[key];
  return value === null || value === undefined ? null : Number(value);
}

function firstText(result: D1Result<Record<string, unknown>>, key: string): string | null {
  const value = result.results?.[0]?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toCountList(result: D1Result<Record<string, unknown>>): { type: string; count: number }[] {
  return ((result.results ?? []) as unknown as CountRow[]).map((row) => ({
    type: row.key ?? "unknown",
    count: Number(row.count),
  }));
}

// 지역 대표 좌표(서울시청 등) 위에 얹힌 행을 세는 조건. geocodeBackfill이 대상을
// 고르는 기준과 같아야 잔량이 실제 처리 대기열과 일치한다. 사용자 입력이 아니라
// 상수 좌표라 바인딩 없이 리터럴로 박는다 (D1 바인딩 100개 한도도 아낀다).
function discoveryFallbackCoordinateMatch(): string {
  const epsilon = 1e-7;
  return REGION_FALLBACK_COORDINATES.map(
    (coordinate) =>
      `(ABS(lat - ${coordinate.lat}) < ${epsilon} AND ABS(lng - ${coordinate.lng}) < ${epsilon})`
  ).join(" OR ");
}

// imageBackfill이 실제로 훑는 source 목록과 같은 값을 쓴다.
function imageBackfillSourceList(): string {
  return Object.keys(IMAGE_SOURCE_KINDS)
    .map((source) => `'${source}'`)
    .join(", ");
}
