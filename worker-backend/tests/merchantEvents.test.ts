import type { D1Database } from "@cloudflare/workers-types";
import { describe, expect, it } from "vitest";
import type { MerchantEventRow } from "../src/merchant/events.js";
import { renderDashboard, renderEventDetail } from "../src/merchant/pages.js";
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
});
