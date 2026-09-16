import type { D1Database } from "@cloudflare/workers-types";
import { describe, expect, it, vi } from "vitest";
import type { MerchantEventRow } from "../src/merchant/events.js";
import { EMPTY_FORM, renderDashboard, renderEventDetail, renderEventForm } from "../src/merchant/pages.js";
import {
  createMerchantApp,
  resolveApprovalPeriod,
  validateEventPeriod,
} from "../src/merchant/routes.js";
import { createSessionToken } from "../src/merchant/session.js";

const event: MerchantEventRow = {
  id: "event-1",
  merchant_id: "merchant-1",
  title: "테스트 이벤트",
  description: "상세 설명",
  benefit: "10% 할인",
  event_type: "discount",
  status: "approved",
  store_name: "테스트 매장",
  address: "인천 연수구 테스트로 1",
  lat: 37.39,
  lng: 126.64,
  start_date: "2026-09-15",
  end_date: "2026-09-20",
  image_url: null,
  source: "merchant",
  source_url: "https://m.place.naver.com/place/123",
  paid_until: "2026-12-15",
  payment_key: "free_launch_promo",
  payment_amount: 0,
  rejection_reason: null,
  created_at: "2026-09-15T00:00:00.000Z",
  updated_at: "2026-09-15T00:00:00.000Z",
};

describe("merchant event period", () => {
  it("rejects an end date before the start date", () => {
    expect(validateEventPeriod("2026-09-15", "2026-09-14", "2026-09-15"))
      .toBe("종료일은 시작일보다 빠를 수 없습니다.");
  });

  it("repairs an expired or reversed period when publication is activated", () => {
    expect(resolveApprovalPeriod(
      { start_date: "2026-09-15", end_date: "2026-05-21" },
      new Date("2026-09-15T03:00:00.000Z"),
    )).toEqual({
      startDate: "2026-09-15",
      endDate: "2026-12-15",
      paidUntil: "2026-12-15",
    });
  });

  it("uses the paid period when the merchant leaves both dates blank", () => {
    expect(resolveApprovalPeriod(
      { start_date: null, end_date: null },
      new Date("2026-09-15T03:00:00.000Z"),
    )).toEqual({
      startDate: "2026-09-15",
      endDate: "2026-12-15",
      paidUntil: "2026-12-15",
    });
  });
});

describe("merchant event representative image", () => {
  it("requires an image in the registration form", () => {
    const html = renderEventForm({ values: EMPTY_FORM, launchPromoFree: true });
    expect(html).toContain('name="image" type="file" accept="image/jpeg,image/png,image/webp" required');
    expect(html).toContain("지도 꽃 핀 중앙에 표시됩니다");
  });

  it.each([false, true])("rejects a missing or empty image before geocoding and writing data (%s)", async (emptyFile) => {
    const secret = "test-session-secret";
    const token = await createSessionToken({ merchantId: "merchant-1", provider: "kakao" }, secret);
    const form = new FormData();
    for (const [key, value] of Object.entries({
      title: "행사", description: "상세", benefit: "할인", event_type: "discount",
      store_name: "매장", address: "인천 연수구 테스트로 1", agree_legal: "on",
    })) form.set(key, value);
    if (emptyFile) form.set("image", new File([], "empty.jpg", { type: "image/jpeg" }));
    const prepare = vi.fn(() => { throw new Error("unexpected database access"); });
    const response = await createMerchantApp().request(
      "/event/new",
      { method: "POST", headers: { cookie: `__merchant_session=${token}` }, body: form },
      { DB: { prepare } as unknown as D1Database, MERCHANT_SESSION_SECRET: secret },
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("지도 꽃 핀에 표시할 대표 이미지를 등록해 주세요");
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe("merchant event detail", () => {
  it("keeps the dashboard detail link and renders owned event fields", () => {
    const dashboard = renderDashboard({
      id: "merchant-1",
      provider: "kakao",
      provider_user_id: "provider-1",
      display_name: "사장님",
      email: null,
      created_at: event.created_at,
      updated_at: event.updated_at,
    }, [event]);
    const detail = renderEventDetail(event);

    expect(dashboard).toContain('href="/merchant/event/event-1"');
    expect(detail).toContain("테스트 이벤트");
    expect(detail).toContain("10% 할인");
    expect(detail).toContain("게시 승인되었습니다");
    expect(detail).toContain("이벤트 내리기");
    expect(detail).toContain('action="/merchant/event/event-1/withdraw"');
    expect(detail).toContain("남은 게시 기간에 대한 환불이 제공되지 않습니다");
  });

  it("serves the authenticated detail route instead of returning 404", async () => {
    const secret = "test-session-secret";
    const token = await createSessionToken(
      { merchantId: "merchant-1", provider: "kakao" },
      secret,
    );
    const db = {
      prepare: () => ({
        bind: () => ({ first: async () => event }),
      }),
    } as unknown as D1Database;
    const response = await createMerchantApp().request(
      "/event/event-1",
      { headers: { cookie: `__merchant_session=${token}` } },
      { DB: db, MERCHANT_SESSION_SECRET: secret },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("테스트 이벤트");
  });

  it("marks an owned approved event as withdrawn after explicit confirmation", async () => {
    const secret = "test-session-secret";
    const token = await createSessionToken(
      { merchantId: "merchant-1", provider: "kakao" },
      secret,
    );
    const update = vi.fn(async () => ({ meta: { changes: 1 } }));
    const prepare = vi.fn((sql: string) => {
      if (sql.includes("UPDATE local_events")) {
        return { bind: () => ({ run: update }) };
      }
      return { bind: () => ({ first: async () => event }) };
    });
    const response = await createMerchantApp().request(
      "/event/event-1/withdraw",
      {
        method: "POST",
        headers: {
          cookie: `__merchant_session=${token}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "confirmation=withdraw",
      },
      { DB: { prepare } as unknown as D1Database, MERCHANT_SESSION_SECRET: secret },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/merchant/event/event-1");
    expect(update).toHaveBeenCalledOnce();
    expect(prepare.mock.calls.some(([sql]) => sql.includes("status = 'expired'"))).toBe(true);
  });

  it("does not change an event without the confirmation value", async () => {
    const secret = "test-session-secret";
    const token = await createSessionToken(
      { merchantId: "merchant-1", provider: "kakao" },
      secret,
    );
    const prepare = vi.fn();
    const response = await createMerchantApp().request(
      "/event/event-1/withdraw",
      {
        method: "POST",
        headers: {
          cookie: `__merchant_session=${token}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "",
      },
      { DB: { prepare } as unknown as D1Database, MERCHANT_SESSION_SECRET: secret },
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("주의사항을 확인한 뒤 이벤트를 내려 주세요");
    expect(prepare).not.toHaveBeenCalled();
  });

  it("does not let one merchant withdraw another merchant's event", async () => {
    const secret = "test-session-secret";
    const token = await createSessionToken(
      { merchantId: "merchant-2", provider: "naver" },
      secret,
    );
    const update = vi.fn();
    const prepare = vi.fn((sql: string) => {
      if (sql.includes("UPDATE local_events")) {
        return { bind: () => ({ run: update }) };
      }
      return { bind: () => ({ first: async () => event }) };
    });
    const response = await createMerchantApp().request(
      "/event/event-1/withdraw",
      {
        method: "POST",
        headers: {
          cookie: `__merchant_session=${token}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "confirmation=withdraw",
      },
      { DB: { prepare } as unknown as D1Database, MERCHANT_SESSION_SECRET: secret },
    );

    expect(response.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });

  it("shows a withdrawn event as directly ended and removes the destructive action", () => {
    const detail = renderEventDetail({
      ...event,
      status: "expired",
      rejection_reason: "merchant_withdrawn",
    });

    expect(detail).toContain("직접 종료");
    expect(detail).toContain("사장님이 게시를 조기 종료했습니다");
    expect(detail).not.toContain("이벤트 내리기");
  });
});
