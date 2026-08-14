// "개발자" 대시보드가 보여줄 수집 파이프라인 현황. 각 테이블의 현재 스냅샷을
// 집계할 뿐, 파이프라인별 실행 이력은 sync_runs(discovery 청크 sync만 기록)
// 외에는 D1에 남아있지 않아 여기서도 만들어내지 않는다.

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

export interface PipelineStats {
  generatedAt: string;
  discoveryItems: {
    total: number;
    byType: { type: string; count: number }[];
    bySource: { source: string; count: number }[];
    taggingCoverage: { tagged: number; total: number };
    feeCoverage: { free: number; paid: number; unknown: number; unchecked: number };
  };
  localEvents: {
    total: number;
    byStatus: { status: string; count: number }[];
    bySource: { source: string; count: number }[];
    needsReview: number;
    taggingCoverage: { tagged: number; total: number };
  };
  cityFestivals: {
    total: number;
    geocodeChecked: number;
    geocodeUnchecked: number;
    upcoming: number;
    ended: number;
  };
  akeiTradeExpos: { total: number };
  recentSyncRuns: SyncRunRow[];
}

export async function queryPipelineStats(db: D1Database): Promise<PipelineStats> {
  const [
    discoveryTotal,
    discoveryByType,
    discoveryBySource,
    discoveryTagged,
    discoveryFee,
    localTotal,
    localByStatus,
    localBySource,
    localNeedsReview,
    localTagged,
    cityTotal,
    cityGeocodeChecked,
    cityUpcoming,
    akeiTotal,
    recentSyncRuns,
  ] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT COUNT(*) AS count FROM discovery_items`),
    db.prepare(`SELECT type AS key, COUNT(*) AS count FROM discovery_items GROUP BY type`),
    db.prepare(`SELECT source AS key, COUNT(*) AS count FROM discovery_items GROUP BY source`),
    db.prepare(`SELECT COUNT(*) AS count FROM discovery_items WHERE tagging_version > 0`),
    db.prepare(
      `SELECT
         SUM(CASE WHEN is_free = 1 THEN 1 ELSE 0 END) AS free,
         SUM(CASE WHEN is_free = 0 THEN 1 ELSE 0 END) AS paid,
         SUM(CASE WHEN is_free IS NULL AND fee_checked_at IS NOT NULL THEN 1 ELSE 0 END) AS unknown,
         SUM(CASE WHEN fee_checked_at IS NULL THEN 1 ELSE 0 END) AS unchecked
       FROM discovery_items`
    ),
    db.prepare(`SELECT COUNT(*) AS count FROM local_events`),
    db.prepare(`SELECT status AS key, COUNT(*) AS count FROM local_events GROUP BY status`),
    db.prepare(`SELECT source AS key, COUNT(*) AS count FROM local_events GROUP BY source`),
    db.prepare(`SELECT COUNT(*) AS count FROM local_events WHERE needs_review = 1`),
    db.prepare(`SELECT COUNT(*) AS count FROM local_events WHERE tagging_version > 0`),
    db.prepare(`SELECT COUNT(*) AS count FROM city_festivals`),
    db.prepare(`SELECT COUNT(*) AS count FROM city_festivals WHERE geocode_checked_at IS NOT NULL`),
    db.prepare(`SELECT COUNT(*) AS count FROM city_festivals WHERE end_date >= date('now')`),
    db.prepare(`SELECT COUNT(*) AS count FROM akei_trade_expos`),
    db.prepare(
      `SELECT id,
              sync_type AS syncType,
              started_at AS startedAt,
              finished_at AS finishedAt,
              status, fetched, upserted, skipped, pruned, message
         FROM sync_runs
        ORDER BY started_at DESC
        LIMIT 10`
    ),
  ]);

  const cityTotalCount = firstCount(cityTotal);

  return {
    generatedAt: new Date().toISOString(),
    discoveryItems: {
      total: firstCount(discoveryTotal),
      byType: toCountList(discoveryByType),
      bySource: toCountList(discoveryBySource).map((row) => ({ source: row.type, count: row.count })),
      taggingCoverage: { tagged: firstCount(discoveryTagged), total: firstCount(discoveryTotal) },
      feeCoverage: {
        free: firstNumber(discoveryFee, "free"),
        paid: firstNumber(discoveryFee, "paid"),
        unknown: firstNumber(discoveryFee, "unknown"),
        unchecked: firstNumber(discoveryFee, "unchecked"),
      },
    },
    localEvents: {
      total: firstCount(localTotal),
      byStatus: toCountList(localByStatus).map((row) => ({ status: row.type, count: row.count })),
      bySource: toCountList(localBySource).map((row) => ({ source: row.type, count: row.count })),
      needsReview: firstCount(localNeedsReview),
      taggingCoverage: { tagged: firstCount(localTagged), total: firstCount(localTotal) },
    },
    cityFestivals: {
      total: cityTotalCount,
      geocodeChecked: firstCount(cityGeocodeChecked),
      geocodeUnchecked: cityTotalCount - firstCount(cityGeocodeChecked),
      upcoming: firstCount(cityUpcoming),
      ended: cityTotalCount - firstCount(cityUpcoming),
    },
    akeiTradeExpos: { total: firstCount(akeiTotal) },
    recentSyncRuns: (recentSyncRuns.results ?? []) as unknown as SyncRunRow[],
  };
}

function firstCount(result: D1Result<Record<string, unknown>>): number {
  return Number(result.results?.[0]?.count ?? 0);
}

function firstNumber(result: D1Result<Record<string, unknown>>, key: string): number {
  return Number(result.results?.[0]?.[key] ?? 0);
}

function toCountList(result: D1Result<Record<string, unknown>>): { type: string; count: number }[] {
  return ((result.results ?? []) as unknown as CountRow[]).map((row) => ({
    type: row.key ?? "unknown",
    count: Number(row.count),
  }));
}
