import { describe, expect, it } from "vitest";
import { buildHeadReviewCard, handleHeadSlackInteraction } from "../src/agents/headSlack.js";

const SECRET = "test-signing-secret";

const row = {
  id: "ev1", merchant_id: "m1", title: "아메리카노 2+1", description: "설명 본문", benefit: "2+1",
  event_type: "discount", status: "pending", store_name: "카페A", address: "서울 중구 1",
  lat: 37.5, lng: 127.0, start_date: "2026-10-01", end_date: "2026-10-31", image_url: "https://x/i.png",
  source: "merchant", source_url: "https://x/c", paid_until: "2026-12-31", payment_key: null,
  payment_amount: 0, rejection_reason: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
};

function fakeDb(status: string) {
  const state = { status, updates: [] as unknown[][], logs: [] as unknown[][] };
  const db = {
    state,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            first: async () => ({ ...row, status: state.status }),
            run: async () => {
              if (sql.trimStart().startsWith("UPDATE local_events")) {
                state.updates.push(args);
                state.status = sql.includes("'approved'") ? "approved" : "rejected";
              } else state.logs.push(args);
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
  return db;
}

async function signed(action: string, value = "ev1", tamper = false) {
  const body = new URLSearchParams({
    payload: JSON.stringify({
      type: "block_actions", user: { username: "sangmin" }, actions: [{ action_id: action, value }],
      response_url: "https://hooks.slack.com/actions/T/B/x",
    }),
  }).toString();
  const ts = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`v0:${ts}:${body}`));
  const sig = "v0=" + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return new Request("https://w/api/slack/interactions", {
    method: "POST",
    headers: { "x-slack-request-timestamp": ts, "x-slack-signature": tamper ? sig.slice(0, -1) + "0" : sig },
    body,
  });
}

describe("head slack", () => {
  it("card shows every entered field and both buttons", () => {
    const text = JSON.stringify(buildHeadReviewCard(row as never, { verdict: "reject", reason: "이벤트 아님" }));
    for (const v of ["카페A", "아메리카노 2+1", "서울 중구 1", "37.5, 127", "설명 본문", "2026-10-01", "https://x/c", "https://x/i.png", "이벤트 아님", "head_approve", "head_reject"]) {
      expect(text).toContain(v);
    }
  });

  it("approve button approves and logs the human decision", async () => {
    const db = fakeDb("rejected");
    const sent: string[] = [];
    const fetcher = (async (url: string) => { sent.push(url); return new Response("ok"); }) as unknown as typeof fetch;
    const res = await handleHeadSlackInteraction(db as never, { SLACK_SIGNING_SECRET: SECRET }, await signed("head_approve"), fetcher);
    expect(res.status).toBe(200);
    expect(db.state.status).toBe("approved");
    expect(db.state.logs).toHaveLength(1);
    expect(sent[0]).toContain("hooks.slack.com");
  });

  it("reject button rejects", async () => {
    const db = fakeDb("pending");
    await handleHeadSlackInteraction(db as never, { SLACK_SIGNING_SECRET: SECRET }, await signed("head_reject"), (async () => new Response("ok")) as unknown as typeof fetch);
    expect(db.state.status).toBe("rejected");
  });

  it("bad signature changes nothing", async () => {
    const db = fakeDb("pending");
    const res = await handleHeadSlackInteraction(db as never, { SLACK_SIGNING_SECRET: SECRET }, await signed("head_approve", "ev1", true));
    expect(res.status).toBe(401);
    expect(db.state.updates).toHaveLength(0);
  });

  it("does not touch pending_payment rows", async () => {
    const db = fakeDb("pending_payment");
    await handleHeadSlackInteraction(db as never, { SLACK_SIGNING_SECRET: SECRET }, await signed("head_approve"), (async () => new Response("ok")) as unknown as typeof fetch);
    expect(db.state.updates).toHaveLength(0);
  });
});
