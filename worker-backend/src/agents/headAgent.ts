import { callAiJson } from "./workersAiClient.js";

export type HeadCandidate = {
  id: string;
  title: string;
  storeName: string;
  address: string;
  benefit: string | null;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  sourceUrl: string | null;
  region: string | null;
  currentStatus: "approved" | "pending" | "rejected";
  rejectionReason: string | null;
  confidenceScore: number;
};

export type HeadVerdict = {
  id: string;
  verdict: "approve" | "pending" | "reject";
  reason: string;
  shortDescription: string | null;
  cleanBenefit: string | null;
};

export type AgentActivityInsert = {
  agentId: string;
  action: string;
  targetKind?: string | null;
  targetId?: string | null;
  targetTitle?: string | null;
  verdict?: string | null;
  reason?: string | null;
  payload?: Record<string, unknown> | null;
};

const SYSTEM_INSTRUCTION = `당신은 한국 매장(식당/카페/상점)의 로컬 이벤트 데이터 큐레이터의 총괄(head)입니다.
수집팀(festa, scout)이 가져온 후보를 검토하고, 다음 셋 중 하나로 판정합니다.
- approve: 매장의 실제 이벤트(할인, 무료 제공, 리뷰 이벤트, 팝업, 한정 메뉴, 오픈 이벤트 등)가 명확하고, 매장 이름·위치·내용이 일관됨.
- pending: 이벤트로 보이나 정보가 모호함(날짜 불명, 매장명 약함, 혜택이 불분명) — 수동 검토 필요.
- reject: 이벤트가 아니거나(일반 음식점 소개 글, 후기 광고로만 보임), 매장과 본문이 매칭이 안되거나, 만료/스팸/중복.

이미 rejected 상태인 후보는 보수적인 규칙으로 반려된 재검토 대상일 수 있습니다.
본문에서 실제 이벤트 혜택과 매장 정보가 충분히 맞으면 approve로 복구하세요.

판정 시 한국어로 한 문장 사유를 작성하세요. 사유는 80자 이내.

approve 또는 pending 판정 시 다음 두 필드를 반드시 작성하세요:
- shortDescription: 앱 사용자에게 보여줄 이벤트 설명 1-2문장. 매장명 제외, 혜택·기간·조건을 자연스러운 한국어로 정리. 예: "아메리카노 2+1 이벤트를 진행 중입니다. 6월 말까지 매장 방문 시 자동 적용됩니다."
- cleanBenefit: 핵심 혜택만 담은 짧은 태그 30자 이내. 예: "아메리카노 2+1", "런치 20% 할인", "신규 오픈 기념 무료 음료"
reject 판정 시 두 필드 모두 null.

응답은 반드시 다음 JSON 스키마:
{"verdicts":[{"id":"...","verdict":"approve|pending|reject","reason":"...","shortDescription":"...|null","cleanBenefit":"...|null"}]}`;

export async function headValidate(
  candidates: HeadCandidate[],
  ai: Ai,
): Promise<HeadVerdict[]> {
  if (candidates.length === 0) return [];
  const prompt = buildPrompt(candidates);
  const json = await callAiJson<{ verdicts: HeadVerdict[] }>({
    ai,
    systemInstruction: SYSTEM_INSTRUCTION,
    prompt,
    temperature: 0.1,
    maxOutputTokens: 2048,
  });
  if (!Array.isArray(json.verdicts)) return [];
  return json.verdicts
    .filter((v) => v && typeof v.id === "string")
    .map((v) => ({
      id: v.id,
      verdict: normalizeVerdict(v.verdict),
      reason: typeof v.reason === "string" ? v.reason.slice(0, 200) : "",
      shortDescription: typeof v.shortDescription === "string" ? v.shortDescription.slice(0, 500) : null,
      cleanBenefit: typeof v.cleanBenefit === "string" ? v.cleanBenefit.slice(0, 60) : null,
    }));
}

function normalizeVerdict(value: unknown): HeadVerdict["verdict"] {
  if (value === "approve" || value === "pending" || value === "reject")
    return value;
  return "pending";
}

function buildPrompt(candidates: HeadCandidate[]): string {
  const list = candidates.map((c, i) => {
    return [
      `[${i + 1}] id=${c.id}`,
      `  현재 상태: ${c.currentStatus}, 점수: ${c.confidenceScore}`,
      `  제목: ${c.title}`,
      `  매장: ${c.storeName}`,
      `  주소: ${c.address}`,
      `  지역: ${c.region ?? "-"}`,
      `  혜택: ${c.benefit ?? "-"}`,
      `  기간: ${c.startDate ?? "-"} ~ ${c.endDate ?? "-"}`,
      `  이전 반려 사유: ${c.rejectionReason ?? "-"}`,
      `  설명: ${truncate(c.description ?? "", 500)}`,
    ].join("\n");
  });
  return [
    "다음 후보들을 검토하고 각각 판정해 주세요.",
    "각 후보의 id를 그대로 verdicts[].id에 넣어야 합니다.",
    "",
    list.join("\n\n"),
  ].join("\n");
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max) + "…";
}

/** UPDATE가 실제로 행을 바꿨으면 true. id가 없거나 0행이면 false. */
export async function applyHeadVerdict(
  db: D1Database,
  verdict: HeadVerdict,
): Promise<boolean> {
  const nextStatus =
    verdict.verdict === "approve"
      ? "approved"
      : verdict.verdict === "reject"
        ? "rejected"
        : "pending";
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE local_events
         SET status = ?,
             rejection_reason = ?,
             updated_at = ?,
             approved_at = CASE WHEN ? = 'approved' AND approved_at IS NULL THEN ? ELSE approved_at END,
             short_description = CASE WHEN ? IS NOT NULL THEN ? ELSE short_description END,
             benefit = CASE WHEN ? IS NOT NULL THEN ? ELSE benefit END
       WHERE id = ?`,
    )
    .bind(
      nextStatus,
      verdict.verdict === "reject" ? verdict.reason : null,
      now,
      nextStatus,
      now,
      verdict.shortDescription,
      verdict.shortDescription,
      verdict.cleanBenefit,
      verdict.cleanBenefit,
      verdict.id,
    )
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function logAgentActivity(
  db: D1Database,
  entry: AgentActivityInsert,
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO agent_activity
           (id, ts, agent_id, action, target_kind, target_id, target_title, verdict, reason, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        randomId(),
        new Date().toISOString(),
        entry.agentId,
        entry.action,
        entry.targetKind ?? null,
        entry.targetId ?? null,
        entry.targetTitle ?? null,
        entry.verdict ?? null,
        entry.reason ?? null,
        entry.payload ? JSON.stringify(entry.payload) : null,
      )
      .run();
  } catch (error) {
    console.error("agent_activity_log_failed", error);
  }
}

function randomId(): string {
  return crypto.randomUUID();
}

export type HeadReviewEnv = {
  AI?: Ai;
  AGENT_HEAD_ENABLED?: string;
  AGENT_HEAD_BATCH_SIZE?: string;
  AGENT_HEAD_MAX_BATCHES?: string;
  AGENT_HEAD_INCLUDE_REJECTED?: string;
};

export type HeadReviewResult = {
  enabled: boolean;
  considered: number;
  reviewed: number;
  approved: number;
  pending: number;
  rejected: number;
  reconsidered: number;
  rescued: number;
  errors: string[];
  /** 최근 실패 기록 때문에 이번 회차를 건너뛰었으면 그 이유. */
  skippedReason?: string;
  generatedAt: string;
};

/** 같은 후보 묶음이 실패하면 이 시간 동안 다시 고르지 않는다. 영구 제외가 아니다. */
export const HEAD_FAILED_TARGET_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type HeadErrorKind =
  | "quota"
  | "run_failed"
  | "empty_response"
  | "json_parse_failed"
  | "other";

export function headErrorKind(message: string): HeadErrorKind {
  if (message.startsWith("workers_ai_run_failed")) {
    // 4006 = Workers AI 무료 Neuron 일일 한도 소진. UTC 자정에 풀린다.
    return /\b4006\b|daily free allocation/i.test(message) ? "quota" : "run_failed";
  }
  if (message.startsWith("workers_ai_empty_response")) return "empty_response";
  if (message.startsWith("workers_ai_json_parse_failed")) return "json_parse_failed";
  return "other";
}

type RecentErrorRow = { ts: string; reason: string | null; payload_json: string | null };

type HeadCooldown = { skipReason: string | null; excludedIds: Set<string> };

/**
 * 최근 orion error 기록으로 이번 회차를 정한다.
 * - 오늘(UTC) 이미 Neuron 한도 오류가 났으면 회차 전체를 건너뛴다 — 같은 날 다시 불러도
 *   같은 오류뿐이고, error 행만 쌓인다.
 * - 그 밖의 실패는 그 묶음의 후보 id를 24시간 동안 고르지 않는다. 다른 후보는 계속 본다.
 */
export async function loadHeadCooldown(
  db: D1Database,
  now: Date,
): Promise<HeadCooldown> {
  const since = new Date(now.getTime() - HEAD_FAILED_TARGET_COOLDOWN_MS).toISOString();
  const { results } = await db
    .prepare(
      `SELECT ts, reason, payload_json FROM agent_activity
        WHERE agent_id = 'orion' AND action = 'error' AND ts > ?
        ORDER BY ts DESC
        LIMIT 50`,
    )
    .bind(since)
    .all<RecentErrorRow>();
  const today = now.toISOString().slice(0, 10);
  let skipReason: string | null = null;
  const excludedIds = new Set<string>();
  for (const row of results ?? []) {
    const kind = headErrorKind(row.reason ?? "");
    if (kind === "quota") {
      if (row.ts.slice(0, 10) === today) skipReason = "workers_ai_quota_cooldown";
      continue;
    }
    for (const id of payloadTargetIds(row.payload_json)) excludedIds.add(id);
  }
  return { skipReason, excludedIds };
}

function payloadTargetIds(json: string | null): string[] {
  if (!json) return [];
  try {
    const ids = (JSON.parse(json) as { targetIds?: unknown }).targetIds;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

type LocalEventRow = {
  id: string;
  title: string;
  store_name: string;
  address: string;
  benefit: string | null;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  source_url: string | null;
  status: string;
  rejection_reason: string | null;
  confidence_score: number | null;
};

export async function runHeadReview(
  db: D1Database,
  env: HeadReviewEnv,
): Promise<HeadReviewResult> {
  const generatedAt = new Date().toISOString();
  const result: HeadReviewResult = {
    enabled: headReviewEnabled(env),
    considered: 0,
    reviewed: 0,
    approved: 0,
    pending: 0,
    rejected: 0,
    reconsidered: 0,
    rescued: 0,
    errors: [],
    generatedAt,
  };
  if (!result.enabled || !env.AI) return result;

  const batchSize = clampInt(Number(env.AGENT_HEAD_BATCH_SIZE ?? 8), 1, 30);
  const maxBatches = clampInt(Number(env.AGENT_HEAD_MAX_BATCHES ?? 1), 1, 20);
  const limit = batchSize * maxBatches;
  const includeRejected = includeRejectedReview(env);
  const statusClause = includeRejected
    ? "('pending', 'approved', 'rejected')"
    : "('pending', 'approved')";

  let cooldown: HeadCooldown;
  try {
    cooldown = await loadHeadCooldown(db, new Date(generatedAt));
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    result.errors.push(`head_review_cooldown_query:${message.slice(0, 100)}`);
    return result;
  }
  if (cooldown.skipReason) {
    result.skippedReason = cooldown.skipReason;
    return result;
  }

  let rows: LocalEventRow[];
  try {
    const queryResult = await db
      .prepare(
        `SELECT le.id, le.title, le.store_name, le.address,
                le.benefit, le.description, le.start_date, le.end_date,
                le.source_url, le.status, le.rejection_reason, le.confidence_score
           FROM local_events le
          WHERE le.status IN ${statusClause}
            AND (
              NOT EXISTS (
                SELECT 1 FROM agent_activity aa
                 WHERE aa.target_id = le.id
                   AND aa.agent_id = 'orion'
                   AND aa.action IN ('validate', 'reconsider')
              )
              OR (le.short_description IS NULL AND le.status <> 'rejected')
            )
          ORDER BY le.short_description ASC, le.updated_at DESC
          LIMIT ?`,
      )
      .bind(limit + cooldown.excludedIds.size)
      .all<LocalEventRow>();
    rows = (queryResult.results ?? [])
      .filter((row) => !cooldown.excludedIds.has(row.id))
      .slice(0, limit);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    result.errors.push(`head_review_query:${message.slice(0, 100)}`);
    // 사무실 화면이 "후보 조회 실패"를 구분해 보여 줄 수 있게 한 줄만 남긴다(원문은 남기지 않는다).
    await logAgentActivity(db, {
      agentId: "orion",
      action: "query_error",
      reason: "head_review_query_failed",
    });
    return result;
  }
  result.considered = rows.length;
  if (rows.length === 0) return result;

  const batches = chunkArray(rows, batchSize).slice(0, maxBatches);
  for (const batch of batches) {
    const payload: HeadCandidate[] = batch.map((row) => ({
      id: row.id,
      title: row.title,
      storeName: row.store_name,
      address: row.address,
      benefit: row.benefit,
      description: row.description,
      startDate: row.start_date,
      endDate: row.end_date,
      sourceUrl: row.source_url,
      region: null,
      currentStatus:
        row.status === "approved"
          ? "approved"
          : row.status === "rejected"
            ? "rejected"
            : "pending",
      rejectionReason: row.rejection_reason,
      confidenceScore: row.confidence_score ?? 0,
    }));
    let verdicts: HeadVerdict[];
    try {
      verdicts = await headValidate(payload, env.AI);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      result.errors.push(`head_validate:${message.slice(0, 600)}`);
      await logAgentActivity(db, {
        agentId: "orion",
        action: "error",
        reason: message.slice(0, 200),
        payload: {
          kind: headErrorKind(message),
          batchSize: batch.length,
          targetIds: batch.map((row) => row.id),
        },
      });
      // 다음 묶음도 대개 같은 이유(한도·장애)로 실패한다. 회차당 error 한 행이면 충분하다.
      break;
    }
    const verdictById = new Map(verdicts.map((v) => [v.id, v]));
    for (const row of batch) {
      const verdict = verdictById.get(row.id);
      if (!verdict) {
        await logAgentActivity(db, {
          agentId: "orion",
          action: "skip",
          targetKind: "local_event",
          targetId: row.id,
          targetTitle: row.title,
          reason: "no_verdict_returned",
        });
        continue;
      }
      let applied = false;
      let applyError = "no_row_updated";
      try {
        applied = await applyHeadVerdict(db, verdict);
      } catch (error) {
        applyError = error instanceof Error ? error.message : "unknown_error";
      }
      if (!applied) {
        // 판정을 DB에 못 썼으면 성공 카운터·validate·post를 남기지 않는다.
        result.errors.push(`head_apply:${applyError.slice(0, 80)}`);
        await logAgentActivity(db, {
          agentId: "orion",
          action: "apply_error",
          targetKind: "local_event",
          targetId: row.id,
          targetTitle: row.title,
          verdict: verdict.verdict,
          reason: `head_apply_failed:${applyError.slice(0, 120)}`,
        });
        continue;
      }
      result.reviewed += 1;
      if (verdict.verdict === "approve") result.approved += 1;
      else if (verdict.verdict === "reject") result.rejected += 1;
      else result.pending += 1;
      const action = row.status === "rejected" ? "reconsider" : "validate";
      if (row.status === "rejected") result.reconsidered += 1;
      if (row.status === "rejected" && verdict.verdict === "approve") {
        result.rescued += 1;
      }
      await logAgentActivity(db, {
        agentId: "orion",
        action,
        targetKind: "local_event",
        targetId: row.id,
        targetTitle: row.title,
        verdict: verdict.verdict,
        reason: verdict.reason,
        payload: { confidenceScore: row.confidence_score },
      });
      if (verdict.verdict === "approve") {
        await logAgentActivity(db, {
          agentId: "echo",
          action: "post",
          targetKind: "local_event",
          targetId: row.id,
          targetTitle: row.title,
        });
      }
    }
  }
  return result;
}

function headReviewEnabled(env: HeadReviewEnv): boolean {
  if (!env.AI) return false;
  const flag = (env.AGENT_HEAD_ENABLED ?? "true").toLowerCase();
  return flag !== "false" && flag !== "0";
}

function includeRejectedReview(env: HeadReviewEnv): boolean {
  const flag = (env.AGENT_HEAD_INCLUDE_REJECTED ?? "true").toLowerCase();
  return flag !== "false" && flag !== "0";
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
