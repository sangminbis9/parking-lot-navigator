import { TourApiDetailClient } from "../../backend/src/features/discover/festivals/tourApiDetailClient.js";
import {
  fetchWithTimeout,
  getString,
  parseXmlItems,
} from "../../backend/src/features/discover/events/eventProviderUtils.js";
import { mapWithConcurrency } from "./concurrency.js";
import { feeFreeFlag, normalizeFee } from "./feeNormalize.js";

// KOPIS pcseguidance와 TourAPI usetimefestival은 목록 응답에 없고 항목별 detail
// 호출로만 얻을 수 있다. sync 한 번에 전부 부르면 subrequest 한도를 넘으므로,
// 요금이 비어 있는 행을 매시간 조금씩 훑어 채운다. 한 번 조회한 행은
// fee_checked_at으로 표시해 정보가 없는 행에 예산이 반복 소모되지 않게 한다.

const DEFAULT_MAX_ITEMS = 120;
// tourApiDetailClient의 DETAIL_ENRICH_CONCURRENCY와 같은 이유(동시 fetch 상한).
const BACKFILL_CONCURRENCY = 5;

type FeeSourceKind = "kopis" | "tourapi";

const FEE_SOURCE_KINDS: Record<string, FeeSourceKind> = {
  kopis: "kopis",
  tourapi: "tourapi",
  "area-based-tour": "tourapi",
  "keyword-tour": "tourapi",
};

interface BackfillRow {
  id: string;
  source: string;
  source_item_id: string;
}

export interface FeeBackfillResult {
  scanned: number;
  filled: number;
  empty: number;
  failed: number;
  bySource: Record<string, { scanned: number; filled: number }>;
}

export interface FeeBackfillEnv {
  KOPIS_API_KEY?: string;
  KOPIS_BASE_URL?: string;
  PUBLIC_DATA_SERVICE_KEY?: string;
  PUBLIC_DATA_BASE_URL?: string;
  FEE_BACKFILL_MAX_ITEMS?: string;
}

export async function runFeeBackfill(
  db: D1Database,
  env: FeeBackfillEnv,
  options: { maxItems?: number } = {},
): Promise<FeeBackfillResult> {
  const maxItems = options.maxItems ?? maxItemsFromEnv(env);
  const sources = Object.keys(FEE_SOURCE_KINDS).filter((source) =>
    hasCredential(env, FEE_SOURCE_KINDS[source]),
  );
  const result: FeeBackfillResult = {
    scanned: 0,
    filled: 0,
    empty: 0,
    failed: 0,
    bySource: {},
  };
  if (sources.length === 0 || maxItems <= 0) return result;

  const placeholders = sources.map(() => "?").join(",");
  const rows = await db
    .prepare(
      `SELECT id, source, source_item_id
         FROM discovery_items
        WHERE source IN (${placeholders})
          AND fee_checked_at IS NULL
          AND (lowest_price_text IS NULL OR lowest_price_text = '')
        ORDER BY start_date
        LIMIT ?`,
    )
    .bind(...sources, maxItems)
    .all<BackfillRow>();

  const targets = rows.results ?? [];
  if (targets.length === 0) return result;

  const tourClient =
    env.PUBLIC_DATA_SERVICE_KEY && env.PUBLIC_DATA_BASE_URL
      ? new TourApiDetailClient(
          env.PUBLIC_DATA_SERVICE_KEY,
          env.PUBLIC_DATA_BASE_URL,
        )
      : null;

  const checkedAt = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];

  const fetched = await mapWithConcurrency(
    targets,
    BACKFILL_CONCURRENCY,
    async (row) => {
      try {
        const kind = FEE_SOURCE_KINDS[row.source];
        const text =
          kind === "kopis"
            ? await fetchKopisFee(env, row.source_item_id)
            : tourClient
              ? await tourClient.admissionFee(contentIdOf(row.source_item_id))
              : null;
        return { row, text, failed: false };
      } catch (error) {
        console.warn(
          `fee backfill failed id=${row.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return { row, text: null, failed: true };
      }
    },
  );

  for (const { row, text, failed } of fetched) {
    result.scanned += 1;
    const bucket = (result.bySource[row.source] ??= { scanned: 0, filled: 0 });
    bucket.scanned += 1;
    if (failed) {
      // 실패한 행은 fee_checked_at을 남기지 않아 다음 회차에 다시 시도한다.
      result.failed += 1;
      continue;
    }
    const fee = normalizeFee(text);
    if (!fee.feeText) {
      result.empty += 1;
      statements.push(
        db
          .prepare(
            "UPDATE discovery_items SET fee_checked_at = ? WHERE id = ?",
          )
          .bind(checkedAt, row.id),
      );
      continue;
    }
    result.filled += 1;
    bucket.filled += 1;
    // raw_payload에도 함께 심어야 다음 full sync의 enrichment 병합이 값을
    // 살려 준다(sync는 raw_payload를 통째로 덮어쓴다).
    const rawKey =
      FEE_SOURCE_KINDS[row.source] === "kopis" ? "$.price" : "$.admissionFee";
    statements.push(
      db
        .prepare(
          `UPDATE discovery_items
              SET lowest_price_text = ?,
                  is_free = COALESCE(?, is_free),
                  raw_payload = CASE
                    WHEN json_valid(raw_payload) THEN json_set(raw_payload, ${JSON.stringify(rawKey)}, ?)
                    ELSE raw_payload
                  END,
                  fee_checked_at = ?
            WHERE id = ?`,
        )
        .bind(fee.feeText, feeFreeFlag(fee), fee.feeText, checkedAt, row.id),
    );
  }

  for (let start = 0; start < statements.length; start += 50) {
    await db.batch(statements.slice(start, start + 50));
  }
  return result;
}

async function fetchKopisFee(
  env: FeeBackfillEnv,
  sourceItemId: string,
): Promise<string | null> {
  const serviceKey = env.KOPIS_API_KEY?.trim();
  const baseUrl = env.KOPIS_BASE_URL;
  if (!serviceKey || !baseUrl) return null;
  const id = sourceItemId.replace(/^kopis:/, "").trim();
  if (!id) return null;
  const url = new URL(`/openApi/restful/pblprfr/${id}`, baseUrl);
  url.searchParams.set("service", serviceKey);
  const response = await fetchWithTimeout(url, {
    headers: { Accept: "application/xml,text/xml,*/*" },
  });
  if (!response.ok) {
    throw new Error(`KOPIS detail API failed: ${response.status}`);
  }
  const detail = parseXmlItems(await response.text(), "db")[0];
  return detail ? getString(detail, ["pcseguidance"]) : null;
}

// discovery_items.source_item_id는 "tourapi:1100492" 형태로 저장된다.
function contentIdOf(sourceItemId: string): string {
  const separator = sourceItemId.lastIndexOf(":");
  return separator >= 0 ? sourceItemId.slice(separator + 1) : sourceItemId;
}

function hasCredential(env: FeeBackfillEnv, kind: FeeSourceKind): boolean {
  return kind === "kopis"
    ? Boolean(env.KOPIS_API_KEY && env.KOPIS_BASE_URL)
    : Boolean(env.PUBLIC_DATA_SERVICE_KEY && env.PUBLIC_DATA_BASE_URL);
}

function maxItemsFromEnv(env: FeeBackfillEnv): number {
  const parsed = Number.parseInt(env.FEE_BACKFILL_MAX_ITEMS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_ITEMS;
}
