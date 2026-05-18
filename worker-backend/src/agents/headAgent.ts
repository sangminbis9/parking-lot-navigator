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
  currentStatus: "approved" | "pending";
  confidenceScore: number;
};

export type HeadVerdict = {
  id: string;
  verdict: "approve" | "pending" | "reject";
  reason: string;
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

판정 시 한국어로 한 문장 사유를 작성하세요. 사유는 80자 이내.

응답은 반드시 다음 JSON 스키마:
{"verdicts":[{"id":"...","verdict":"approve|pending|reject","reason":"..."}]}`;

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

export async function applyHeadVerdict(
  db: D1Database,
  verdict: HeadVerdict,
): Promise<void> {
  const nextStatus =
    verdict.verdict === "approve"
      ? "approved"
      : verdict.verdict === "reject"
        ? "rejected"
        : "pending";
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE local_events
         SET status = ?,
             rejection_reason = ?,
             updated_at = ?,
             approved_at = CASE WHEN ? = 'approved' AND approved_at IS NULL THEN ? ELSE approved_at END
       WHERE id = ?`,
    )
    .bind(
      nextStatus,
      verdict.verdict === "reject" ? verdict.reason : null,
      now,
      nextStatus,
      now,
      verdict.id,
    )
    .run();
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
  return (
    crypto.randomUUID?.() ??
    `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  );
}

export type HeadReviewEnv = {
  AI?: Ai;
  AGENT_HEAD_ENABLED?: string;
  AGENT_HEAD_BATCH_SIZE?: string;
  AGENT_HEAD_MAX_BATCHES?: string;
};

export type HeadReviewResult = {
  enabled: boolean;
  considered: number;
  reviewed: number;
  approved: number;
  pending: number;
  rejected: number;
  errors: string[];
  generatedAt: string;
};

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
    errors: [],
    generatedAt,
  };
  if (!result.enabled || !env.AI) return result;

  const batchSize = clampInt(Number(env.AGENT_HEAD_BATCH_SIZE ?? 8), 1, 30);
  const maxBatches = clampInt(Number(env.AGENT_HEAD_MAX_BATCHES ?? 1), 1, 20);
  const limit = batchSize * maxBatches;

  let rows: LocalEventRow[];
  try {
    const queryResult = await db
      .prepare(
        `SELECT le.id, le.title, le.store_name, le.address,
                le.benefit, le.description, le.start_date, le.end_date,
                le.source_url, le.status, le.confidence_score
           FROM local_events le
          WHERE le.status IN ('pending', 'approved')
            AND NOT EXISTS (
              SELECT 1 FROM agent_activity aa
               WHERE aa.target_id = le.id
                 AND aa.agent_id = 'orion'
                 AND aa.action = 'validate'
            )
          ORDER BY le.updated_at DESC
          LIMIT ?`,
      )
      .bind(limit)
      .all<LocalEventRow>();
    rows = queryResult.results ?? [];
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    result.errors.push(`head_review_query:${message.slice(0, 100)}`);
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
      currentStatus: row.status === "approved" ? "approved" : "pending",
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
        payload: { batchSize: batch.length },
      });
      continue;
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
      try {
        await applyHeadVerdict(db, verdict);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "unknown_error";
        result.errors.push(`head_apply:${message.slice(0, 80)}`);
      }
      result.reviewed += 1;
      if (verdict.verdict === "approve") result.approved += 1;
      else if (verdict.verdict === "reject") result.rejected += 1;
      else result.pending += 1;
      await logAgentActivity(db, {
        agentId: "orion",
        action: "validate",
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
