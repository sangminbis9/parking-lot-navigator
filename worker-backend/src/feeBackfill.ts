import { TourApiDetailClient } from "../../backend/src/features/discover/festivals/tourApiDetailClient.js";
import {
  fetchWithTimeout,
  getString,
  parseXmlItems,
} from "../../backend/src/features/discover/events/eventProviderUtils.js";
import { combineProgramInfo } from "../../backend/src/features/discover/events/KopisEventProvider.js";
import { mapWithConcurrency } from "./concurrency.js";
import { isRetryableBackfillError } from "./backfillRetry.js";
import { feeFreeFlag, normalizeFee } from "./feeNormalize.js";
import { seoulDayString } from "./kstDate.js";

// KOPIS pcseguidance와 TourAPI usetimefestival, 그리고 프로그램·출연진 정보
// (KOPIS dtguidance/prfcast/prfcrew, TourAPI playtime/program/subevent)는 목록
// 응답에 없고 항목별 detail 호출로만 얻는다. 한 행의 detail은 한 번만 열고 거기서
// 요금과 프로그램을 함께 뽑는다 — 추가 subrequest는 없다.
//
// 재조회 정책은 네 상태다(migration 0026):
//   1) 값 확보 완료      fee_filled_at / program_filled_at — 그 필드는 두 번 다시 안 본다
//   2) 조회했지만 없음   detail_state='empty' + detail_retry_after(행사 임박도별 backoff).
//                        아직 공개 안 된 정보가 나중에 올라오면 자연히 보강된다.
//   3) 일시적 실패       detail_retry_after만 지수 backoff로 미룬다. 영구 확정 아님.
//   4) 영구 조회 불필요  detail_state='nodata' — NODATA, 잘못된 source id, 종료된 행사.
//
// 대상을 고른 직후 detail_attempts를 올리고 detail_retry_after를 짧게 선점한다.
// invocation이 CPU/시간 초과로 중간에 죽어도 다음 회차가 같은 행에 갇히지 않고,
// 결과는 청크마다 바로 쓰므로 죽기 전까지의 작업이 통째로 사라지지 않는다.

// invocation당 subrequest 예산이 50이고 항목당 fetch는 1건이다. D1 쿼리는 이
// 한도에 포함되지 않으므로 image backfill과 같은 45까지 쓸 수 있다.
const DEFAULT_MAX_ITEMS = 45;
// tourApiDetailClient의 DETAIL_ENRICH_CONCURRENCY와 같은 이유(동시 fetch 상한).
const BACKFILL_CONCURRENCY = 5;
// 이만큼 끝날 때마다 D1에 쓴다. 회차 끝에 한 번만 쓰면 중간에 죽을 때 전부 잃는다.
const FLUSH_CHUNK = 10;
// 선점 유지 시간. 이 시간 안에 결과를 못 쓰면 다른 회차가 다시 가져간다.
const CLAIM_TTL_MINUTES = 15;
// 일시적 실패의 지수 backoff 상한.
const TRANSIENT_BACKOFF_BASE_MINUTES = 5;
const TRANSIENT_BACKOFF_MAX_MINUTES = 6 * 60;

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
  start_date: string | null;
  end_date: string | null;
  fee_filled_at: string | null;
  program_filled_at: string | null;
  detail_attempts: number;
}

interface SourceCounters {
  scanned: number;
  feeFilled: number;
  programFilled: number;
}

export interface FeeBackfillResult {
  /** 이번 회차에 선점해 처리한 행 수. */
  scanned: number;
  /** 실제로 detail API를 부른 횟수(=소모한 subrequest). */
  detailFetched: number;
  feeFilled: number;
  /** 이미 요금을 확보해 이번 회차에 요금을 다시 안 본 행. */
  feeAlreadyComplete: number;
  /** 조회는 됐는데 요금이 아직 없어 backoff 뒤 다시 볼 행. */
  feeEmptyPending: number;
  programFilled: number;
  programAlreadyComplete: number;
  programEmptyPending: number;
  /** 영구적으로 조회 불필요로 확정한 행(NODATA·잘못된 id·종료된 행사). */
  permanentNoData: number;
  /** 429/5xx/timeout 등 일시적 실패. 확정하지 않고 backoff만 건다. */
  transientFailed: number;
  bySource: Record<string, SourceCounters>;
  /** 실패가 몰릴 때 원인을 로그 없이 응답만으로 가릴 수 있게 남기는 표본. */
  errors?: string[];
  /** 아직 요금을 못 채운 진행/예정 행 수. */
  feeBacklog: number;
  /** 아직 프로그램 정보를 못 채운 진행/예정 행 수. */
  programBacklog: number;
  /**
   * scanned가 0일 때 그 이유. "처리할 행이 없음"과 "자격증명이 없어 아무것도
   * 못 함"을 로그만 보고 구분할 수 있어야 한다.
   */
  reason?:
    | "max_items_zero"
    | "no_credentials"
    | "no_pending_rows";
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
  options: { maxItems?: number; now?: Date } = {},
): Promise<FeeBackfillResult> {
  const now = options.now ?? new Date();
  const maxItems = options.maxItems ?? maxItemsFromEnv(env);
  const sources = Object.keys(FEE_SOURCE_KINDS).filter((source) =>
    hasCredential(env, FEE_SOURCE_KINDS[source]),
  );
  const result: FeeBackfillResult = {
    scanned: 0,
    detailFetched: 0,
    feeFilled: 0,
    feeAlreadyComplete: 0,
    feeEmptyPending: 0,
    programFilled: 0,
    programAlreadyComplete: 0,
    programEmptyPending: 0,
    permanentNoData: 0,
    transientFailed: 0,
    bySource: {},
    feeBacklog: 0,
    programBacklog: 0,
  };
  if (maxItems <= 0) return { ...result, reason: "max_items_zero" };
  if (sources.length === 0) return { ...result, reason: "no_credentials" };

  const nowIso = now.toISOString();
  const today = seoulDayString(now);
  const placeholders = sources.map(() => "?").join(",");

  Object.assign(result, await backlog(db, sources, today));

  // 아직 필요한 필드가 남아 있고, 영구 제외가 아니고, 재시도 시각이 지난 행만.
  // 종료된 행사는 앱에 보이지 않으므로 예산을 쓰지 않는다.
  // 한 번도 안 본 행(detail_attempts=0)을 먼저, 그다음 시작이 임박한 행부터.
  const rows = await db
    .prepare(
      `SELECT id, source, source_item_id, start_date, end_date,
              fee_filled_at, program_filled_at, detail_attempts
         FROM discovery_items
        WHERE source IN (${placeholders})
          AND (end_date IS NULL OR end_date >= ?)
          AND (fee_filled_at IS NULL OR program_filled_at IS NULL)
          AND (detail_state IS NULL OR detail_state <> 'nodata')
          AND (detail_retry_after IS NULL OR detail_retry_after <= ?)
        ORDER BY detail_attempts ASC, start_date ASC
        LIMIT ?`,
    )
    .bind(...sources, today, nowIso, maxItems)
    .all<BackfillRow>();

  const targets = rows.results ?? [];
  if (targets.length === 0) return { ...result, reason: "no_pending_rows" };

  // 선점. 여기서 실패하면 아무것도 안 부르고 끝낸다 — 선점 없이 fetch하면
  // invocation이 죽었을 때 같은 행이 영원히 선두에 남는다.
  const claimUntil = plusMinutes(now, CLAIM_TTL_MINUTES);
  await flush(
    db,
    targets.map((row) =>
      db
        .prepare(
          `UPDATE discovery_items
              SET detail_attempts = detail_attempts + 1,
                  detail_retry_after = ?
            WHERE id = ?`,
        )
        .bind(claimUntil, row.id),
    ),
  );

  const tourClient =
    env.PUBLIC_DATA_SERVICE_KEY && env.PUBLIC_DATA_BASE_URL
      ? new TourApiDetailClient(
          env.PUBLIC_DATA_SERVICE_KEY,
          env.PUBLIC_DATA_BASE_URL,
        )
      : null;
  const errorSamples = new Set<string>();

  for (let start = 0; start < targets.length; start += FLUSH_CHUNK) {
    const chunk = targets.slice(start, start + FLUSH_CHUNK);
    const fetched = await mapWithConcurrency(
      chunk,
      BACKFILL_CONCURRENCY,
      async (row) => {
        try {
          const kind = FEE_SOURCE_KINDS[row.source];
          const detail =
            kind === "kopis"
              ? await fetchKopisDetail(env, row.source_item_id)
              : tourClient
                ? await fetchTourDetail(tourClient, row.source_item_id)
                : EMPTY_DETAIL;
          return { row, ...detail, error: null as string | null };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return { row, ...EMPTY_DETAIL, error: message };
        }
      },
    );

    const statements: D1PreparedStatement[] = [];
    for (const { row, fee: feeText, program, error } of fetched) {
      result.scanned += 1;
      result.detailFetched += 1;
      const bucket = (result.bySource[row.source] ??= {
        scanned: 0,
        feeFilled: 0,
        programFilled: 0,
      });
      bucket.scanned += 1;

      if (error) {
        if (errorSamples.size < 5) errorSamples.add(error);
        if (isRetryableBackfillError(error)) {
          // 3) 일시적 실패 — 확정하지 않고 뒤로 미룬다.
          result.transientFailed += 1;
          console.warn(`fee backfill retryable id=${row.id}: ${error}`);
          statements.push(
            db
              .prepare(
                `UPDATE discovery_items SET detail_retry_after = ? WHERE id = ?`,
              )
              .bind(transientRetryAfter(now, row), row.id),
          );
          continue;
        }
        // 4) 영구 실패 — 이 id로는 다시 불러도 같다.
        result.permanentNoData += 1;
        console.warn(`fee backfill permanent id=${row.id}: ${error}`);
        statements.push(terminalStatement(db, row.id, nowIso));
        continue;
      }

      const sets: string[] = [];
      const binds: unknown[] = [];
      let rawExpr = "raw_payload";
      const rawBinds: unknown[] = [];

      const needsFee = !row.fee_filled_at;
      if (!needsFee) result.feeAlreadyComplete += 1;
      const fee = needsFee ? normalizeFee(feeText) : { feeType: "unknown" as const, feeText: null };
      if (needsFee && fee.feeText) {
        // 1) 값 확보 완료
        result.feeFilled += 1;
        bucket.feeFilled += 1;
        sets.push(
          "lowest_price_text = ?",
          "is_free = COALESCE(?, is_free)",
          "fee_filled_at = ?",
        );
        binds.push(fee.feeText, feeFreeFlag(fee), nowIso);
        const rawKey =
          FEE_SOURCE_KINDS[row.source] === "kopis" ? "$.price" : "$.admissionFee";
        rawExpr = `json_set(${rawExpr}, ${JSON.stringify(rawKey)}, ?)`;
        rawBinds.push(fee.feeText);
      } else if (needsFee) {
        result.feeEmptyPending += 1;
      }

      const needsProgram = !row.program_filled_at;
      if (!needsProgram) result.programAlreadyComplete += 1;
      if (needsProgram && program) {
        result.programFilled += 1;
        bucket.programFilled += 1;
        rawExpr = `json_set(${rawExpr}, '$.programInfo', ?)`;
        rawBinds.push(program);
        sets.push("program_filled_at = ?");
        binds.push(nowIso);
      } else if (needsProgram) {
        result.programEmptyPending += 1;
      }

      if (rawBinds.length > 0) {
        // raw_payload에도 심어야 다음 full sync의 enrichment 병합이 값을 살린다
        // (sync는 raw_payload를 통째로 덮어쓴다).
        sets.push(
          `raw_payload = CASE
             WHEN json_valid(raw_payload) THEN ${rawExpr}
             ELSE raw_payload
           END`,
        );
        binds.push(...rawBinds);
      }

      const stillMissing =
        (needsFee && !fee.feeText) || (needsProgram && !program);
      if (!stillMissing) {
        // 두 필드 모두 확보. 이 행은 더 볼 이유가 없다.
        sets.push("detail_state = 'done'", "detail_retry_after = NULL");
      } else if (hasEnded(row, today)) {
        // 4) 종료된 행사에 끝까지 정보가 없으면 확정한다.
        result.permanentNoData += 1;
        sets.push("detail_state = 'nodata'", "detail_retry_after = NULL");
      } else {
        // 2) 조회 성공했지만 아직 없음 — 임박도에 따라 다시 본다.
        sets.push("detail_state = 'empty'", "detail_retry_after = ?");
        binds.push(emptyRetryAfter(now, row, today));
      }
      // pipelineStats 대시보드가 읽는 "마지막 시도 시각".
      sets.push("fee_checked_at = ?", "program_checked_at = ?");
      binds.push(nowIso, nowIso);

      statements.push(
        db
          .prepare(`UPDATE discovery_items SET ${sets.join(", ")} WHERE id = ?`)
          .bind(...binds, row.id),
      );
    }
    await flush(db, statements);
  }

  if (errorSamples.size > 0) result.errors = [...errorSamples];
  return result;
}

async function flush(
  db: D1Database,
  statements: D1PreparedStatement[],
): Promise<void> {
  for (let start = 0; start < statements.length; start += 50) {
    await db.batch(statements.slice(start, start + 50));
  }
}

function terminalStatement(
  db: D1Database,
  id: string,
  nowIso: string,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE discovery_items
          SET detail_state = 'nodata',
              detail_retry_after = NULL,
              fee_checked_at = ?,
              program_checked_at = ?
        WHERE id = ?`,
    )
    .bind(nowIso, nowIso, id);
}

async function backlog(
  db: D1Database,
  sources: string[],
  today: string,
): Promise<{ feeBacklog: number; programBacklog: number }> {
  const placeholders = sources.map(() => "?").join(",");
  const rows = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN fee_filled_at IS NULL THEN 1 ELSE 0 END) AS feeBacklog,
         SUM(CASE WHEN program_filled_at IS NULL THEN 1 ELSE 0 END) AS programBacklog
       FROM discovery_items
      WHERE source IN (${placeholders})
        AND (end_date IS NULL OR end_date >= ?)
        AND (detail_state IS NULL OR detail_state <> 'nodata')`,
    )
    .bind(...sources, today)
    .all<{ feeBacklog: number | null; programBacklog: number | null }>();
  const row = rows.results?.[0];
  return {
    feeBacklog: row?.feeBacklog ?? 0,
    programBacklog: row?.programBacklog ?? 0,
  };
}

/**
 * 조회는 됐지만 값이 아직 없는 행의 다음 확인 시각. 시작이 멀수록 드물게 본다.
 * 5분 cron의 슬롯 하나(하루 72회 × 45건 = 3,240건)로 감당할 수 있는 간격이다.
 */
function emptyRetryAfter(now: Date, row: BackfillRow, today: string): string {
  const days = daysUntil(row.start_date, today);
  if (days === null || days > 30) return plusMinutes(now, 7 * 24 * 60);
  if (days > 7) return plusMinutes(now, 24 * 60);
  return plusMinutes(now, 6 * 60);
}

/**
 * 일시적 실패의 다음 재시도 시각. 같은 행이 계속 실패하면 점점 뒤로 미뤄
 * 예산을 독점하지 못하게 하되, 영구 확정은 하지 않는다.
 */
function transientRetryAfter(now: Date, row: BackfillRow): string {
  const attempts = Math.max(1, row.detail_attempts ?? 1);
  const minutes = Math.min(
    TRANSIENT_BACKOFF_BASE_MINUTES * 2 ** (attempts - 1),
    TRANSIENT_BACKOFF_MAX_MINUTES,
  );
  return plusMinutes(now, minutes);
}

function hasEnded(row: BackfillRow, today: string): boolean {
  return Boolean(row.end_date && row.end_date < today);
}

function daysUntil(startDate: string | null, today: string): number | null {
  if (!startDate) return null;
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const base = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(base)) return null;
  return Math.round((start - base) / 86_400_000);
}

function plusMinutes(now: Date, minutes: number): string {
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

// 한 detail 응답에서 뽑아 오는 두 값. 둘 다 같은 fetch 결과다.
interface DetailFields {
  fee: string | null;
  program: string | null;
}

const EMPTY_DETAIL: DetailFields = { fee: null, program: null };

async function fetchKopisDetail(
  env: FeeBackfillEnv,
  sourceItemId: string,
): Promise<DetailFields> {
  const serviceKey = env.KOPIS_API_KEY?.trim();
  const baseUrl = env.KOPIS_BASE_URL;
  if (!serviceKey || !baseUrl) return EMPTY_DETAIL;
  const id = sourceItemId.replace(/^kopis:/, "").trim();
  if (!id) throw new Error("KOPIS detail NODATA: empty source id");
  const url = new URL(`/openApi/restful/pblprfr/${id}`, baseUrl);
  url.searchParams.set("service", serviceKey);
  const response = await fetchWithTimeout(url, {
    headers: { Accept: "application/xml,text/xml,*/*" },
  });
  // 429/5xx는 일시적이라 던져서 backoff 뒤 재시도하고, 그 밖의 4xx는 이 id로는
  // 영원히 실패하므로 영구 확정한다.
  if (!response.ok) {
    if (response.status === 429 || response.status >= 500) {
      throw new Error(`KOPIS detail API failed: ${response.status}`);
    }
    throw new Error(`KOPIS detail NODATA: ${response.status}`);
  }
  const detail = parseXmlItems(await response.text(), "db")[0];
  if (!detail) return EMPTY_DETAIL;
  return {
    fee: getString(detail, ["pcseguidance"]),
    program: combineProgramInfo(detail),
  };
}

// admissionFee와 programInfo는 introItemCache를 공유하므로 fetch는 1건뿐이다.
// admissionFee가 먼저 던지므로 조회 실패가 "정보 없음"으로 둔갑하지 않는다.
async function fetchTourDetail(
  client: TourApiDetailClient,
  sourceItemId: string,
): Promise<DetailFields> {
  const contentId = contentIdOf(sourceItemId);
  const fee = await client.admissionFee(contentId);
  const program = await client.programInfo(contentId);
  return { fee, program };
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
