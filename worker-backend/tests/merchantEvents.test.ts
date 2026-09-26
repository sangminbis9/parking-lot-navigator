import type { D1Database } from "@cloudflare/workers-types";
import { describe, expect, it, vi } from "vitest";
import { isRenewableEvent, type MerchantEventRow } from "../src/merchant/events.js";
import {
  EMPTY_FORM,
  renderDashboard,
  renderEventDetail,
  renderEventForm,
  renderTossPayment,
} from "../src/merchant/pages.js";
import {
  createMerchantApp,
  resolveApprovalPeriod,
  validateEventPeriod,
} from "../src/merchant/routes.js";
import { createSessionToken } from "../src/merchant/session.js";
import { normalizeKoreanPhone } from "../src/merchant/store.js";

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
  // 연장 가능 여부가 실제 시계에 걸리지 않도록 먼 미래로 둔다.
  paid_until: "2099-12-31",
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
      endDate: "2026-10-15",
      paidUntil: "2026-10-15",
    });
  });

  it("uses the paid period when the merchant leaves both dates blank", () => {
    expect(resolveApprovalPeriod(
      { start_date: null, end_date: null },
      new Date("2026-09-15T03:00:00.000Z"),
    )).toEqual({
      startDate: "2026-09-15",
      endDate: "2026-10-15",
      paidUntil: "2026-10-15",
    });
  });
});

describe("free registration last day", () => {
  it("caps the free publication period at 2026-12-31", () => {
    expect(resolveApprovalPeriod(
      { start_date: null, end_date: null },
      new Date("2026-11-01T03:00:00.000Z"),
      "2026-12-31",
    )).toEqual({
      startDate: "2026-11-01",
      endDate: "2026-12-31",
      paidUntil: "2026-12-31",
    });
  });

  it("limits the date pickers and confirms the paid transition on submit", () => {
    const html = renderEventForm({ values: EMPTY_FORM, launchPromoFree: true });
    expect(html).toContain('name="end_date" type="date" max="2026-12-31"');
    expect(html).toContain("2027년부터는 유료로 전환되어 다시 등록하셔야 합니다");
    const paid = renderEventForm({ values: EMPTY_FORM, launchPromoFree: false });
    expect(paid).not.toContain('max="2026-12-31"');
  });

  it("requires an end date unless the ongoing checkbox is checked", async () => {
    const html = renderEventForm({ values: EMPTY_FORM, launchPromoFree: true });
    expect(html).toContain('value="" required />');
    expect(html).toContain('name="no_end_date" value="1"');
    const ongoing = renderEventForm({ values: { ...EMPTY_FORM, noEndDate: true }, launchPromoFree: true });
    expect(ongoing).toContain('value="" disabled />');
    expect(ongoing).toContain('value="1" style="width:auto;" checked');

    const secret = "test-session-secret";
    const token = await createSessionToken({ merchantId: "merchant-1", provider: "kakao" }, secret);
    const form = new FormData();
    for (const [key, value] of Object.entries({
      title: "행사", description: "상세", benefit: "할인", event_type: "discount",
      store_name: "매장", address: "인천 연수구 테스트로 1", agree_legal: "on",
      contact_name: "홍길동", contact_phone: "01012345678", contact_email: "owner@example.com",
    })) form.set(key, value);
    const prepare = vi.fn(() => { throw new Error("unexpected database access"); });
    const response = await createMerchantApp().request(
      "/event/new",
      { method: "POST", headers: { cookie: `__merchant_session=${token}` }, body: form },
      { DB: { prepare } as unknown as D1Database, MERCHANT_SESSION_SECRET: secret },
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("종료일을 선택하거나 상시 이벤트를 체크해 주세요");
    expect(prepare).not.toHaveBeenCalled();
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
      store_name: "매장", address: "인천 연수구 테스트로 1", agree_legal: "on", no_end_date: "1",
      contact_name: "홍길동", contact_phone: "01012345678", contact_email: "owner@example.com",
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

describe("merchant registrant contact", () => {
  it.each([
    ["01012345678", "010-1234-5678"],
    ["010-1234-5678", "010-1234-5678"],
    ["0111234567", "011-123-4567"],
    ["0212345678", "02-1234-5678"],
    ["021234567", "02-123-4567"],
    ["0311234567", "031-123-4567"],
    ["07012345678", "070-1234-5678"],
    ["15881234", "1588-1234"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeKoreanPhone(input)).toBe(expected);
  });

  it.each(["", "1234", "010123", "010123456789", "02123456789", "12345678"])(
    "rejects invalid phone %s",
    (input) => {
      expect(normalizeKoreanPhone(input)).toBeNull();
    },
  );

  it("renders required contact fields with phone auto-formatting", () => {
    const html = renderEventForm({ values: EMPTY_FORM, launchPromoFree: true });
    expect(html).toContain('name="contact_name" required');
    expect(html).toContain('name="contact_phone" type="tel" inputmode="numeric" required');
    expect(html).toContain('name="contact_email" type="email" required');
    expect(html).toContain("phoneInput.value = formatPhone(phoneInput.value)");
  });

  it.each([
    [{ contact_phone: "" }, "필수 항목을 모두 입력해 주세요"],
    [{ contact_phone: "12345" }, "등록자 전화번호를 확인해 주세요"],
    [{ contact_email: "not-an-email" }, "등록자 성함과 이메일 주소를 확인해 주세요"],
  ])("rejects invalid contact %o before touching the database", async (override, message) => {
    const secret = "test-session-secret";
    const token = await createSessionToken({ merchantId: "merchant-1", provider: "kakao" }, secret);
    const form = new FormData();
    for (const [key, value] of Object.entries({
      title: "행사", description: "상세", benefit: "할인", event_type: "discount",
      store_name: "매장", address: "인천 연수구 테스트로 1", agree_legal: "on",
      contact_name: "홍길동", contact_phone: "01012345678", contact_email: "owner@example.com",
      ...override,
    })) form.set(key, value);
    const prepare = vi.fn(() => { throw new Error("unexpected database access"); });
    const response = await createMerchantApp().request(
      "/event/new",
      { method: "POST", headers: { cookie: `__merchant_session=${token}` }, body: form },
      { DB: { prepare } as unknown as D1Database, MERCHANT_SESSION_SECRET: secret },
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain(message);
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
    expect(response.headers.get("location")).toBe("/merchant/dashboard");
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

describe("merchant admin", () => {
  const secret = "test-session-secret";
  const adminEnv = (prepare: unknown) => ({
    DB: { prepare } as unknown as D1Database,
    MERCHANT_SESSION_SECRET: secret,
    MERCHANT_ADMIN_IDS: " admin-1 , admin-2",
  });
  const adminEvent = { ...event, merchant_name: "사장님", merchant_provider: "kakao" };
  const post = async (merchantId: string, path: string, body: string, prepare: unknown) => {
    const token = await createSessionToken({ merchantId, provider: "kakao" }, secret);
    return createMerchantApp().request(
      path,
      {
        method: "POST",
        headers: {
          cookie: `__merchant_session=${token}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
      },
      adminEnv(prepare),
    );
  };

  it("hides the admin area from non-admin merchants", async () => {
    const token = await createSessionToken({ merchantId: "merchant-1", provider: "kakao" }, secret);
    const prepare = vi.fn();
    const response = await createMerchantApp().request(
      "/admin",
      { headers: { cookie: `__merchant_session=${token}` } },
      adminEnv(prepare),
    );
    expect(response.status).toBe(404);
    expect(prepare).not.toHaveBeenCalled();
    expect((await post("merchant-1", "/admin/event/event-1/publish", "", prepare)).status).toBe(404);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("lists every merchant event for an admin", async () => {
    const token = await createSessionToken({ merchantId: "admin-2", provider: "naver" }, secret);
    const prepare = vi.fn(() => ({ all: async () => ({ results: [adminEvent] }) }));
    const response = await createMerchantApp().request(
      "/admin",
      { headers: { cookie: `__merchant_session=${token}` } },
      adminEnv(prepare),
    );
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("테스트 이벤트");
    expect(html).toContain('href="/merchant/admin/event/event-1"');
  });

  it("shows the admin link on the dashboard only for admins", () => {
    const merchant = {
      id: "admin-1", provider: "kakao" as const, provider_user_id: "p", display_name: null,
      email: null, created_at: event.created_at, updated_at: event.updated_at,
    };
    expect(renderDashboard(merchant, [], true)).toContain('href="/merchant/admin"');
    expect(renderDashboard(merchant, [], false)).not.toContain('href="/merchant/admin"');
  });

  it.each(["reason=spam", "confirmation=hide", "confirmation=hide&reason=%20"])(
    "does not hide without confirmation and a reason (%s)",
    async (body) => {
      const prepare = vi.fn();
      const response = await post("admin-1", "/admin/event/event-1/hide", body, prepare);
      expect(response.status).toBe(400);
      expect(prepare).not.toHaveBeenCalled();
    },
  );

  it("hides an event as rejected with the reason after confirmation", async () => {
    const bind = vi.fn(() => ({ run: async () => ({ meta: { changes: 1 } }) }));
    const prepare = vi.fn(() => ({ bind }));
    const response = await post(
      "admin-1", "/admin/event/event-1/hide", "confirmation=hide&reason=%ED%97%88%EC%9C%84", prepare,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/merchant/admin/event/event-1");
    expect(prepare.mock.calls[0][0]).toContain("status = 'rejected'");
    expect(bind.mock.calls[0][0]).toBe("허위");
  });

  it("re-publishes a hidden event", async () => {
    const prepare = vi.fn(() => ({ bind: () => ({ run: async () => ({ meta: { changes: 1 } }) }) }));
    const response = await post("admin-1", "/admin/event/event-1/publish", "", prepare);
    expect(response.status).toBe(303);
    expect(prepare.mock.calls[0][0]).toContain("status = 'approved'");
  });

  it("refuses to re-publish when nothing matched", async () => {
    const prepare = vi.fn(() => ({ bind: () => ({ run: async () => ({ meta: { changes: 0 } }) }) }));
    const response = await post("admin-1", "/admin/event/event-1/publish", "", prepare);
    expect(response.status).toBe(409);
  });

  it("keeps coordinates and dates when the admin edits text only", async () => {
    const update = vi.fn(() => ({ run: async () => ({ meta: { changes: 1 } }) }));
    const prepare = vi.fn((sql: string) =>
      sql.includes("UPDATE local_events")
        ? { bind: update }
        : { bind: () => ({ first: async () => adminEvent }) });
    const body = new URLSearchParams({
      title: "고친 제목", description: "상세 설명", benefit: "10% 할인", event_type: "discount",
      store_name: "테스트 매장", address: event.address, coupon_url: "", start_date: "", end_date: "",
    }).toString();
    const response = await post("admin-1", "/admin/event/event-1/edit", body, prepare);
    expect(response.status).toBe(303);
    const args = update.mock.calls[0] as unknown[];
    expect(args[0]).toBe("고친 제목");
    expect(args.slice(5, 10)).toEqual([event.address, 37.39, 126.64, "2026-09-15", "2026-09-20"]);
  });
});

describe("merchant event renewal", () => {
  const merchant = {
    id: "merchant-1",
    provider: "kakao",
    provider_user_id: "provider-1",
    display_name: "사장님",
    email: null,
    contact_name: "홍길동",
    phone: "010-1234-5678",
    contact_email: "owner@example.com",
    created_at: event.created_at,
    updated_at: event.updated_at,
  };
  const ended: MerchantEventRow = {
    ...event,
    paid_until: "2026-12-31",
    end_date: "2026-12-31",
    image_url: "https://example.com/image.png",
  };
  const now = new Date("2027-01-05T03:00:00.000Z");

  it("treats hidden, withdrawn and past-paid events as renewable", () => {
    expect(isRenewableEvent({ status: "rejected", paid_until: "2026-12-31" }, now)).toBe(true);
    expect(isRenewableEvent({ status: "expired", paid_until: null }, now)).toBe(true);
    expect(isRenewableEvent({ status: "approved", paid_until: "2026-12-31" }, now)).toBe(true);
    expect(isRenewableEvent({ status: "approved", paid_until: "2027-01-05" }, now)).toBe(false);
    expect(isRenewableEvent({ status: "pending_payment", paid_until: null }, now)).toBe(false);
  });

  it("links renewable events to the prefilled renew form", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    try {
      expect(renderDashboard(merchant, [ended])).toContain('href="/merchant/event/event-1/renew"');
      expect(renderEventDetail(ended)).toContain("연장/재등록");
      expect(renderEventDetail(ended)).not.toContain("이벤트 내리기");
    } finally {
      vi.useRealTimers();
    }
    const form = renderEventForm({ values: EMPTY_FORM, launchPromoFree: false, renewEventId: "event-1" });
    expect(form).toContain('action="/merchant/event/event-1/renew"');
    expect(form).toContain("결제하기");
    expect(form).not.toMatch(/name="image"[^>]*required/);
  });

  it("puts the event id prefix on a unique Toss orderId", () => {
    expect(renderTossPayment({
      event: { ...ended, status: "pending_payment" },
      clientKey: "test_ck",
      customerKey: "merchant-1",
      amount: 9900,
      successUrl: "https://example.com/s",
      failUrl: "https://example.com/f",
      customerName: "홍길동",
    })).toMatch(/event-1_[0-9a-z]+/);
  });

  it("renews an ended event in place and sends the merchant to payment", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    try {
      const secret = "test-session-secret";
      const token = await createSessionToken({ merchantId: "merchant-1", provider: "kakao" }, secret);
      const renew = vi.fn(async () => ({ meta: { changes: 1 } }));
      const prepare = vi.fn((sql: string) => {
        if (sql.includes("UPDATE local_events")) return { bind: () => ({ run: renew }) };
        if (sql.includes("UPDATE merchants")) return { bind: () => ({ run: async () => ({ meta: { changes: 1 } }) }) };
        return { bind: () => ({ first: async () => ended }) };
      });
      const body = new URLSearchParams({
        title: ended.title,
        description: ended.description ?? "",
        benefit: ended.benefit ?? "",
        event_type: ended.event_type,
        store_name: ended.store_name,
        address: ended.address,
        start_date: "2027-01-05",
        end_date: "2027-01-20",
        contact_name: "홍길동",
        contact_phone: "01012345678",
        contact_email: "owner@example.com",
        agree_legal: "1",
      });
      const response = await createMerchantApp().request(
        "/event/event-1/renew",
        {
          method: "POST",
          headers: {
            cookie: `__merchant_session=${token}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
        },
        {
          DB: { prepare } as unknown as D1Database,
          MERCHANT_SESSION_SECRET: secret,
          MERCHANT_LAUNCH_PROMO_FREE: "false",
        },
      );

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/merchant/event/event-1/pay");
      expect(renew).toHaveBeenCalledOnce();
      expect(prepare.mock.calls.some(([sql]) => sql.includes("status = 'pending_payment'"))).toBe(true);
      expect(prepare.mock.calls.some(([sql]) => sql.includes("INSERT INTO local_events"))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses to renew an event that is still published", async () => {
    const secret = "test-session-secret";
    const token = await createSessionToken({ merchantId: "merchant-1", provider: "kakao" }, secret);
    const prepare = vi.fn(() => ({ bind: () => ({ first: async () => event }) }));
    const response = await createMerchantApp().request(
      "/event/event-1/renew",
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
    expect(response.status).toBe(409);
  });
});
