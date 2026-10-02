import { describe, expect, it } from "vitest";
import { callAiJson, callAiText } from "../src/agents/workersAiClient.js";
import { headErrorKind, runHeadReview } from "../src/agents/headAgent.js";

function aiReturning(value: unknown): Ai {
  return { run: async () => value } as unknown as Ai;
}

function aiThrowing(message: string): Ai {
  return {
    run: async () => {
      throw new Error(message);
    },
  } as unknown as Ai;
}

describe("workersAiClient", () => {
  it("parses a string JSON response", async () => {
    const out = await callAiJson<{ a: number }>({
      ai: aiReturning({ response: '```json\n{"a":1}\n```' }),
      prompt: "p",
    });
    expect(out).toEqual({ a: 1 });
  });

  it("accepts an already-parsed object response (JSON mode)", async () => {
    const out = await callAiJson<{ verdicts: unknown[] }>({
      ai: aiReturning({ response: { verdicts: [] } }),
      prompt: "p",
    });
    expect(out).toEqual({ verdicts: [] });
  });

  it("reports malformed JSON separately and without the raw text", async () => {
    const err = await callAiJson({
      ai: aiReturning({ response: "{not json SECRET_PROMPT" }),
      prompt: "p",
    }).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/^workers_ai_json_parse_failed:/);
    expect((err as Error).message).not.toContain("SECRET_PROMPT");
  });

  it("reports empty responses", async () => {
    for (const raw of [{ response: "" }, { response: null }, {}, null]) {
      await expect(
        callAiJson({ ai: aiReturning(raw), prompt: "p" }),
      ).rejects.toThrow("workers_ai_empty_response");
    }
    await expect(
      callAiText({ ai: aiReturning({ response: "   " }), prompt: "p" }),
    ).rejects.toThrow("workers_ai_empty_response");
  });

  it("reports run failures", async () => {
    await expect(
      callAiJson({ ai: aiThrowing("boom"), prompt: "p" }),
    ).rejects.toThrow("workers_ai_run_failed:boom");
  });
});

describe("headErrorKind", () => {
  it("classifies error reasons", () => {
    expect(
      headErrorKind(
        "workers_ai_run_failed:4006: you have used up your daily free allocation of 10,000 neurons",
      ),
    ).toBe("quota");
    expect(headErrorKind("workers_ai_run_failed:boom")).toBe("run_failed");
    expect(headErrorKind("workers_ai_empty_response")).toBe("empty_response");
    expect(headErrorKind("workers_ai_json_parse_failed:x")).toBe("json_parse_failed");
  });
});

type Activity = {
  ts: string;
  agent_id: string;
  action: string;
  target_id: string | null;
  reason: string | null;
  payload_json: string | null;
};

/// runHeadReview가 발행하는 문장 모양만 흉내 낸다.
function fakeDb(opts: {
  events: Array<{ id: string; title: string; status: string }>;
  activity?: Activity[];
  updateChanges?: number;
  updateThrows?: boolean;
}) {
  const activity: Activity[] = [...(opts.activity ?? [])];
  const db = {
    activity,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const exec = async () => {
            const s = sql.trimStart();
            if (s.startsWith("SELECT ts, reason, payload_json FROM agent_activity")) {
              const since = args[0] as string;
              return {
                results: activity
                  .filter((a) => a.agent_id === "orion" && a.action === "error" && a.ts > since)
                  .sort((a, b) => b.ts.localeCompare(a.ts)),
              };
            }
            if (s.startsWith("SELECT le.id")) {
              const limit = args[0] as number;
              return {
                results: opts.events.slice(0, limit).map((e) => ({
                  ...e,
                  store_name: null,
                  address: null,
                  benefit: null,
                  description: null,
                  start_date: null,
                  end_date: null,
                  source_url: null,
                  rejection_reason: null,
                  confidence_score: 0.5,
                })),
              };
            }
            if (s.startsWith("UPDATE local_events")) {
              if (opts.updateThrows) throw new Error("D1_ERROR: busy");
              return { meta: { changes: opts.updateChanges ?? 1 } };
            }
            if (s.startsWith("INSERT INTO agent_activity")) {
              activity.push({
                ts: args[1] as string,
                agent_id: args[2] as string,
                action: args[3] as string,
                target_id: args[5] as string | null,
                reason: args[8] as string | null,
                payload_json: args[9] as string | null,
              });
              return { meta: { changes: 1 } };
            }
            throw new Error(`unexpected sql: ${s.slice(0, 40)}`);
          };
          return { all: exec, run: exec };
        },
      };
    },
  };
  return db;
}

const events = [
  { id: "e1", title: "할인", status: "pending" },
  { id: "e2", title: "증정", status: "pending" },
];

function env(ai: Ai) {
  return { AI: ai, AGENT_HEAD_BATCH_SIZE: "1", AGENT_HEAD_MAX_BATCHES: "3" };
}

const approveAll = aiReturning({
  response: {
    verdicts: [
      { id: "e1", verdict: "approve", reason: "ok", shortDescription: "s" },
      { id: "e2", verdict: "approve", reason: "ok", shortDescription: "s" },
    ],
  },
});

describe("runHeadReview", () => {
  it("counts and logs validate/post only when the UPDATE changed a row", async () => {
    const db = fakeDb({ events, updateChanges: 0 });
    const result = await runHeadReview(db as unknown as D1Database, env(approveAll));
    expect(result.reviewed).toBe(0);
    expect(result.approved).toBe(0);
    const actions = db.activity.map((a) => `${a.agent_id}:${a.action}`);
    expect(actions).not.toContain("orion:validate");
    expect(actions).not.toContain("echo:post");
    expect(actions.filter((a) => a === "orion:apply_error")).toHaveLength(2);
  });

  it("logs apply_error when the UPDATE throws", async () => {
    const db = fakeDb({ events, updateThrows: true });
    const result = await runHeadReview(db as unknown as D1Database, env(approveAll));
    expect(result.reviewed).toBe(0);
    expect(db.activity.every((a) => a.action === "apply_error")).toBe(true);
  });

  it("counts and logs on success", async () => {
    const db = fakeDb({ events });
    const result = await runHeadReview(db as unknown as D1Database, env(approveAll));
    expect(result.reviewed).toBe(2);
    expect(result.approved).toBe(2);
    expect(db.activity.filter((a) => a.action === "post")).toHaveLength(2);
  });

  it("writes one error row per run, then cools down the failed targets", async () => {
    const db = fakeDb({ events });
    const ai = aiReturning({ response: "" });
    await runHeadReview(db as unknown as D1Database, env(ai));
    expect(db.activity.filter((a) => a.action === "error")).toHaveLength(1);
    expect(JSON.parse(db.activity[0]!.payload_json!).targetIds).toEqual(["e1"]);

    // 다음 회차: e1은 24시간 쿨다운, e2만 시도한다.
    await runHeadReview(db as unknown as D1Database, env(ai));
    const errors = db.activity.filter((a) => a.action === "error");
    expect(errors).toHaveLength(2);
    expect(JSON.parse(errors[1]!.payload_json!).targetIds).toEqual(["e2"]);

    // 둘 다 쿨다운이면 아무것도 고르지 않고 로그도 안 남긴다.
    const third = await runHeadReview(db as unknown as D1Database, env(ai));
    expect(third.considered).toBe(0);
    expect(db.activity.filter((a) => a.action === "error")).toHaveLength(2);
  });

  it("skips the rest of the UTC day after a neuron quota error", async () => {
    const db = fakeDb({ events });
    const ai = aiThrowing("4006: you have used up your daily free allocation of 10,000 neurons");
    await runHeadReview(db as unknown as D1Database, env(ai));
    const second = await runHeadReview(db as unknown as D1Database, env(ai));
    expect(second.skippedReason).toBe("workers_ai_quota_cooldown");
    expect(db.activity.filter((a) => a.action === "error")).toHaveLength(1);
  });

  it("does not block targets whose failure is older than the cooldown", async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const db = fakeDb({
      events,
      activity: [
        {
          ts: old,
          agent_id: "orion",
          action: "error",
          target_id: null,
          reason: "workers_ai_empty_response",
          payload_json: JSON.stringify({ targetIds: ["e1", "e2"] }),
        },
      ],
    });
    const result = await runHeadReview(db as unknown as D1Database, env(approveAll));
    expect(result.reviewed).toBe(2);
  });
});
