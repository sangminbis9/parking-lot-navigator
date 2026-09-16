import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { describe, expect, it, vi } from "vitest";
import type { MerchantEventRow } from "../src/merchant/events.js";
import {
  buildMerchantEventCreatedPayload,
  sendMerchantEventCreatedSlack,
  sendMerchantEventCreatedSlackCard,
} from "../src/merchant/slack.js";

const event: MerchantEventRow = {
  id: "merchant-event-1",
  merchant_id: "merchant-1",
  title: "<!channel> 테스트",
  description: "사장님이 입력한 상세 설명",
  benefit: "음료 1잔 무료",
  event_type: "freebie",
  status: "pending_payment",
  store_name: "테스트 매장",
  address: "인천 연수구 테스트로 1",
  lat: 37.39,
  lng: 126.64,
  start_date: null,
  end_date: null,
  image_url: "https://example.com/event.jpg",
  source: "merchant",
  source_url: "https://m.place.naver.com/place/123",
  paid_until: null,
  payment_key: null,
  payment_amount: null,
  rejection_reason: null,
  created_at: "2026-09-15T09:00:00.000Z",
  updated_at: "2026-09-15T09:00:00.000Z",
};

function dbReturning(row: MerchantEventRow | null): D1Database {
  return {
    prepare: () => ({ bind: () => ({ first: async () => row }) }),
  } as unknown as D1Database;
}

describe("merchant registration Slack", () => {
  it("renders every submitted event field, coupon action, and full image block", () => {
    const payload = buildMerchantEventCreatedPayload(event);
    const text = JSON.stringify(payload);
    expect(text).toContain("사장님 이벤트 신규 등록");
    expect(text).toContain("음료 1잔 무료");
    expect(text).toContain("사장님이 입력한 상세 설명");
    expect(text).toContain("https://m.place.naver.com/place/123");
    expect(text).toContain("https://example.com/event.jpg");
    expect(text).toContain("&lt;!channel&gt; 테스트");
  });

  it("posts once and records an R2 marker so queue retries do not duplicate it", async () => {
    const keys = new Set<string>();
    const bucket = {
      head: async (key: string) => keys.has(key) ? ({ key }) : null,
      put: async (key: string) => { keys.add(key); return {}; },
    } as unknown as R2Bucket;
    const fetcher = vi.fn(async () => new Response("ok"));
    const env = {
      DB: dbReturning(event),
      DISCOVERY_SNAPSHOTS: bucket,
      SLACK_DAILY_REPORT_WEBHOOK_URL: "https://hooks.slack.com/services/T/B/secret",
    };

    await expect(sendMerchantEventCreatedSlackCard(env, event, fetcher)).resolves.toEqual({ sent: true });
    await expect(sendMerchantEventCreatedSlack(env, event.id, fetcher)).resolves.toEqual({
      sent: false,
      skipped: "already_sent",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("leaves the message retryable when Slack rejects it", async () => {
    const fetcher = vi.fn(async () => new Response("busy", { status: 503 }));
    await expect(sendMerchantEventCreatedSlack({
      DB: dbReturning(event),
      SLACK_DAILY_REPORT_WEBHOOK_URL: "https://hooks.slack.com/services/T/B/secret",
    }, event.id, fetcher)).rejects.toThrow("slack_webhook_failed:503");
  });
});
