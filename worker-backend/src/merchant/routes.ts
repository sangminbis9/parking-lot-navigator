import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import {
  buildKakaoAuthorizeUrl,
  buildNaverAuthorizeUrl,
  callbackPath,
  exchangeKakaoCode,
  exchangeNaverCode,
} from "./oauth.js";
import {
  EMPTY_FORM,
  type ContactValues,
  renderDashboard,
  renderEventDetail,
  renderEventForm,
  renderFreeClaim,
  renderLanding,
  renderMessage,
  renderPaymentFail,
  renderTossPayment,
  renderAdminEventDetail,
  renderAdminList,
  type EventFormValues,
} from "./pages.js";
import {
  getMerchantById,
  normalizeKoreanPhone,
  updateMerchantContact,
  upsertMerchant,
} from "./store.js";
import {
  adminHideMerchantEvent,
  adminPublishMerchantEvent,
  adminUpdateMerchantEvent,
  getAdminMerchantEvent,
  listAllMerchantEvents,
  createMerchantEvent,
  geocodeAddress,
  getMerchantEventById,
  listMerchantEvents,
  isRenewableEvent,
  markEventApproved,
  MERCHANT_WITHDRAWAL_REASON,
  renewMerchantEvent,
  withdrawMerchantEvent,
  parseNaverCouponLink,
  couponSourceItemId,
  uploadEventImage,
  type MerchantEventType,
  type MerchantEventRow,
} from "./events.js";
import { addMonths, confirmTossPayment } from "./toss.js";
import type { BackgroundJob } from "../jobs.js";
import { sendMerchantEventCreatedSlackCard } from "./slack.js";
import {
  createSessionToken,
  randomToken,
  SESSION_TTL_SECONDS,
  verifySessionToken,
  type MerchantProvider,
  type SessionPayload,
} from "./session.js";

export type MerchantEnv = {
  DB: D1Database;
  MERCHANT_IMAGES?: R2Bucket;
  NAVER_CLIENT_ID?: string;
  NAVER_CLIENT_SECRET?: string;
  KAKAO_REST_API_KEY?: string;
  KAKAO_CLIENT_SECRET?: string;
  KAKAO_LOCAL_BASE_URL?: string;
  MERCHANT_SESSION_SECRET?: string;
  /** 쉼표로 구분한 merchants.id 목록. 여기 있는 계정만 /merchant/admin을 본다. */
  MERCHANT_ADMIN_IDS?: string;
  MERCHANT_PUBLIC_BASE_URL?: string;
  TOSS_CLIENT_KEY?: string;
  TOSS_SECRET_KEY?: string;
  MERCHANT_LAUNCH_PROMO_FREE?: string;
  SLACK_DAILY_REPORT_WEBHOOK_URL?: string;
  BACKGROUND_QUEUE?: Queue<BackgroundJob>;
};

const EVENT_PRICE_KRW = 9900;
const EVENT_DURATION_MONTHS = 1;
// 무료 등록은 2026년까지만 연다. 2027년부터는 유료로 다시 등록해야 한다.
export const FREE_REGISTRATION_LAST_DAY = "2026-12-31";

function launchPromoEnabled(env: MerchantEnv): boolean {
  const raw = (env.MERCHANT_LAUNCH_PROMO_FREE ?? "").trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "off" || raw === "no") {
    return false;
  }
  return true;
}

const EVENT_TYPES: readonly MerchantEventType[] = [
  "discount",
  "freebie",
  "review_event",
  "popup",
  "limited_menu",
  "opening_event",
  "etc",
];

function parseEventType(value: string): MerchantEventType {
  return (EVENT_TYPES as readonly string[]).includes(value)
    ? (value as MerchantEventType)
    : "etc";
}

function normalizeDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

function koreaDay(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function isValidDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateEventPeriod(
  startDate: string,
  endDate: string,
  today: string,
): string | null {
  if (startDate && !isValidDay(startDate)) return "시작일 형식이 올바르지 않습니다.";
  if (endDate && !isValidDay(endDate)) return "종료일 형식이 올바르지 않습니다.";
  if (startDate && endDate && endDate < startDate) {
    return "종료일은 시작일보다 빠를 수 없습니다.";
  }
  if (endDate && endDate < today) return "이미 지난 종료일은 등록할 수 없습니다.";
  return null;
}

export function resolveApprovalPeriod(
  event: Pick<MerchantEventRow, "start_date" | "end_date">,
  now: Date,
  lastDay?: string,
): { startDate: string; endDate: string; paidUntil: string } {
  const activatedOn = koreaDay(now);
  const fullPeriodEnd = addMonths(
    new Date(`${activatedOn}T00:00:00Z`),
    EVENT_DURATION_MONTHS,
  )
    .toISOString()
    .slice(0, 10);
  // 무료 등록(lastDay)은 결제 기간과 무관하게 lastDay까지 게시한다.
  const paidUntil = lastDay ?? fullPeriodEnd;
  const existingStart = event.start_date;
  const existingEnd = event.end_date;
  const periodStillUsable = Boolean(
    existingEnd &&
      existingEnd >= activatedOn &&
      (!existingStart || existingEnd >= existingStart),
  );
  const endDate = periodStillUsable ? existingEnd! : paidUntil;
  return {
    startDate: periodStillUsable ? (existingStart ?? activatedOn) : activatedOn,
    endDate: lastDay && endDate > lastDay ? lastDay : endDate,
    paidUntil,
  };
}

const SESSION_COOKIE = "__merchant_session";
const STATE_COOKIE_PREFIX = "__merchant_oauth_state_";

function baseUrl(env: MerchantEnv, requestUrl: string): string {
  if (env.MERCHANT_PUBLIC_BASE_URL) {
    return env.MERCHANT_PUBLIC_BASE_URL.replace(/\/$/, "");
  }
  const u = new URL(requestUrl);
  return `${u.protocol}//${u.host}`;
}

function redirectUri(
  env: MerchantEnv,
  requestUrl: string,
  provider: MerchantProvider,
): string {
  return `${baseUrl(env, requestUrl)}${callbackPath(provider)}`;
}

function providerEnabled(
  env: MerchantEnv,
  provider: MerchantProvider,
): boolean {
  if (!env.MERCHANT_SESSION_SECRET) return false;
  if (provider === "naver") {
    return Boolean(env.NAVER_CLIENT_ID && env.NAVER_CLIENT_SECRET);
  }
  return Boolean(env.KAKAO_REST_API_KEY);
}

async function loadSession(
  env: MerchantEnv,
  cookieHeader: string | undefined,
): Promise<SessionPayload | null> {
  if (!env.MERCHANT_SESSION_SECRET) return null;
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(/;\s*/)
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!match) return null;
  const token = decodeURIComponent(match.slice(SESSION_COOKIE.length + 1));
  return verifySessionToken(token, env.MERCHANT_SESSION_SECRET);
}

function isMerchantAdmin(env: MerchantEnv, merchantId: string): boolean {
  return (env.MERCHANT_ADMIN_IDS ?? "")
    .split(",")
    .some((id) => id.trim() === merchantId);
}

function logAdminAction(
  action: string,
  eventId: string,
  adminId: string,
  reason?: string,
): void {
  console.log(JSON.stringify({
    event: "merchant_admin_action",
    action,
    eventId,
    adminId,
    reason,
  }));
}

export function createMerchantApp() {
  const app = new Hono<{ Bindings: MerchantEnv }>();

  app.get("/", async (c) => {
    const session = await loadSession(c.env, c.req.header("cookie"));
    if (session) return c.redirect("/merchant/dashboard");
    return c.html(
      renderLanding({
        naverEnabled: providerEnabled(c.env, "naver"),
        kakaoEnabled: providerEnabled(c.env, "kakao"),
        launchPromoFree: launchPromoEnabled(c.env),
      }),
    );
  });

  app.get("/dashboard", async (c) => {
    const session = await loadSession(c.env, c.req.header("cookie"));
    if (!session) return c.redirect("/merchant");
    const merchant = await getMerchantById(c.env.DB, session.merchantId);
    if (!merchant) {
      deleteCookie(c, SESSION_COOKIE, { path: "/merchant" });
      return c.redirect("/merchant");
    }
    const events = await listMerchantEvents(c.env.DB, merchant.id);
    return c.html(
      renderDashboard(merchant, events, isMerchantAdmin(c.env, merchant.id)),
    );
  });

  app.post("/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/merchant" });
    return c.redirect("/merchant");
  });

  for (const provider of ["naver", "kakao"] as const) {
    app.get(`/auth/${provider}`, (c) => {
      if (!providerEnabled(c.env, provider)) {
        return c.html(
          renderMessage(
            "로그인 불가",
            `${provider} 로그인이 구성되지 않았습니다.`,
          ),
          503,
        );
      }
      const state = randomToken();
      setCookie(c, `${STATE_COOKIE_PREFIX}${provider}`, state, {
        path: "/merchant",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
        maxAge: 600,
      });
      const config = {
        clientId:
          provider === "naver"
            ? (c.env.NAVER_CLIENT_ID as string)
            : (c.env.KAKAO_REST_API_KEY as string),
        clientSecret:
          provider === "naver"
            ? c.env.NAVER_CLIENT_SECRET
            : c.env.KAKAO_CLIENT_SECRET,
      };
      const url =
        provider === "naver"
          ? buildNaverAuthorizeUrl(
              config,
              redirectUri(c.env, c.req.url, provider),
              state,
            )
          : buildKakaoAuthorizeUrl(
              config,
              redirectUri(c.env, c.req.url, provider),
              state,
            );
      return c.redirect(url);
    });

    app.get(`/auth/${provider}/callback`, async (c) => {
      if (!providerEnabled(c.env, provider)) {
        return c.html(
          renderMessage(
            "로그인 불가",
            `${provider} 로그인이 구성되지 않았습니다.`,
          ),
          503,
        );
      }
      const code = c.req.query("code");
      const state = c.req.query("state");
      const storedState = getCookie(c, `${STATE_COOKIE_PREFIX}${provider}`);
      deleteCookie(c, `${STATE_COOKIE_PREFIX}${provider}`, {
        path: "/merchant",
      });
      if (!code || !state || !storedState || state !== storedState) {
        return c.html(
          renderMessage(
            "로그인 실패",
            "인증 상태가 일치하지 않습니다. 다시 시도해 주세요.",
          ),
          400,
        );
      }
      try {
        const config = {
          clientId:
            provider === "naver"
              ? (c.env.NAVER_CLIENT_ID as string)
              : (c.env.KAKAO_REST_API_KEY as string),
          clientSecret:
            provider === "naver"
              ? c.env.NAVER_CLIENT_SECRET
              : c.env.KAKAO_CLIENT_SECRET,
        };
        const profile =
          provider === "naver"
            ? await exchangeNaverCode(config, code, state)
            : await exchangeKakaoCode(
                config,
                code,
                redirectUri(c.env, c.req.url, provider),
              );
        const merchant = await upsertMerchant(c.env.DB, provider, profile);
        const token = await createSessionToken(
          { merchantId: merchant.id, provider },
          c.env.MERCHANT_SESSION_SECRET as string,
        );
        setCookie(c, SESSION_COOKIE, token, {
          path: "/merchant",
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
          maxAge: SESSION_TTL_SECONDS,
        });
        return c.redirect("/merchant/dashboard");
      } catch (error) {
        console.error("merchant oauth callback failed", error);
        return c.html(
          renderMessage(
            "로그인 실패",
            "잠시 후 다시 시도해 주세요. 문제가 계속되면 관리자에게 문의하세요.",
          ),
          500,
        );
      }
    });
  }

  app.get("/event/new", async (c) => {
    const session = await loadSession(c.env, c.req.header("cookie"));
    if (!session) return c.redirect("/merchant");
    const merchant = await getMerchantById(c.env.DB, session.merchantId);
    return c.html(
      renderEventForm({
        values: EMPTY_FORM,
        contact: {
          name: merchant?.contact_name ?? "",
          phone: merchant?.phone ?? "",
          email: merchant?.contact_email ?? merchant?.email ?? "",
        },
        launchPromoFree: launchPromoEnabled(c.env),
      }),
    );
  });

  app.get("/event/:id/renew", async (c) => {
    const session = await loadSession(c.env, c.req.header("cookie"));
    if (!session) return c.redirect("/merchant");
    const event = await getMerchantEventById(c.env.DB, c.req.param("id"));
    if (!event || event.merchant_id !== session.merchantId) {
      return c.html(renderMessage("이벤트를 찾을 수 없음", "다시 시도해 주세요."), 404);
    }
    if (!isRenewableEvent(event)) return c.redirect(`/merchant/event/${event.id}`);
    const merchant = await getMerchantById(c.env.DB, session.merchantId);
    // 이미 지난 기간은 그대로 내면 검증에 걸린다. 비워 두고 사장님이 새로 고르게 한다.
    const periodPassed = Boolean(event.end_date && event.end_date < koreaDay(new Date()));
    return c.html(
      renderEventForm({
        values: {
          title: event.title,
          description: event.description ?? "",
          benefit: event.benefit ?? "",
          eventType: event.event_type,
          storeName: event.store_name,
          address: event.address,
          couponUrl: event.source_url ?? "",
          startDate: periodPassed ? "" : (event.start_date ?? ""),
          endDate: periodPassed ? "" : (event.end_date ?? ""),
          // 상시 이벤트는 승인 때 종료일을 게시 기간 끝으로 채웠다.
          noEndDate: !event.end_date || event.end_date === event.paid_until,
        },
        contact: {
          name: merchant?.contact_name ?? "",
          phone: merchant?.phone ?? "",
          email: merchant?.contact_email ?? merchant?.email ?? "",
        },
        launchPromoFree: launchPromoEnabled(c.env),
        renewEventId: event.id,
      }),
    );
  });

  // 새 등록과 연장/재등록은 같은 폼·검증을 쓴다. 연장은 이미지가 선택이고 행을 새로 만들지 않는다.
  app.on("POST", ["/event/new", "/event/:id/renew"], async (c) => {
    const session = await loadSession(c.env, c.req.header("cookie"));
    if (!session) return c.redirect("/merchant");
    let renewing: MerchantEventRow | null = null;
    if (c.req.path.endsWith("/renew")) {
      renewing = await getMerchantEventById(c.env.DB, c.req.param("id") ?? "");
      if (!renewing || renewing.merchant_id !== session.merchantId || !isRenewableEvent(renewing)) {
        return c.html(
          renderMessage("연장/재등록 불가", "이 이벤트는 지금 연장/재등록할 수 없습니다. 대시보드에서 상태를 확인해 주세요."),
          409,
        );
      }
    }
    const form = await c.req.formData();
    const values: EventFormValues = {
      title: String(form.get("title") ?? "").trim(),
      description: String(form.get("description") ?? "").trim(),
      benefit: String(form.get("benefit") ?? "").trim(),
      eventType: parseEventType(String(form.get("event_type") ?? "")),
      storeName: String(form.get("store_name") ?? "").trim(),
      address: String(form.get("address") ?? "").trim(),
      couponUrl: String(form.get("coupon_url") ?? "").trim(),
      startDate: String(form.get("start_date") ?? "").trim(),
      endDate: String(form.get("end_date") ?? "").trim(),
      noEndDate: form.get("no_end_date") === "1",
    };
    // 상시 이벤트는 종료일을 비워 두고 승인 때 게시 기간 끝(paid_until)으로 채운다.
    // NULL로 남기면 목록 쿼리가 시작 14일 뒤 숨긴다(localEvents.ts).
    if (values.noEndDate) values.endDate = "";
    const contact: ContactValues = {
      name: String(form.get("contact_name") ?? "").trim(),
      phone: String(form.get("contact_phone") ?? "").trim(),
      email: String(form.get("contact_email") ?? "").trim(),
    };

    const missing = (
      ["title", "description", "benefit", "storeName", "address"] as const
    ).filter((key) => !values[key]);
    const promoFree = launchPromoEnabled(c.env);
    if (missing.length > 0 || !contact.name || !contact.phone || !contact.email) {
      return c.html(
        renderEventForm({
          values,
          contact,
          error: "필수 항목을 모두 입력해 주세요.",
          launchPromoFree: promoFree,
          renewEventId: renewing?.id,
        }),
        400,
      );
    }

    const phone = normalizeKoreanPhone(contact.phone);
    if (!phone) {
      return c.html(
        renderEventForm({
          values,
          contact,
          error: "등록자 전화번호를 확인해 주세요. 예: 010-0000-0000",
          launchPromoFree: promoFree,
          renewEventId: renewing?.id,
        }),
        400,
      );
    }
    contact.phone = phone;
    if (contact.name.length > 30 || contact.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
      return c.html(
        renderEventForm({
          values,
          contact,
          error: "등록자 성함과 이메일 주소를 확인해 주세요.",
          launchPromoFree: promoFree,
          renewEventId: renewing?.id,
        }),
        400,
      );
    }

    const periodError =
      (!values.noEndDate && !values.endDate
        ? "종료일을 선택하거나 상시 이벤트를 체크해 주세요."
        : null) ??
      validateEventPeriod(values.startDate, values.endDate, koreaDay(new Date())) ??
      (promoFree &&
      (values.startDate > FREE_REGISTRATION_LAST_DAY ||
        values.endDate > FREE_REGISTRATION_LAST_DAY)
        ? "무료 등록은 2026년 12월 31일까지 게시하는 이벤트만 가능합니다. 2027년부터는 유료로 전환되어 다시 등록하셔야 합니다."
        : null);
    if (periodError) {
      return c.html(
        renderEventForm({
          values,
          contact,
          error: periodError,
          launchPromoFree: promoFree,
          renewEventId: renewing?.id,
        }),
        400,
      );
    }

    const couponLink = parseNaverCouponLink(values.couponUrl);
    if (couponLink === undefined) {
      return c.html(
        renderEventForm({
          values,
          contact,
          error:
            "네이버 쿠폰 링크는 네이버 예약·플레이스 주소만 등록할 수 있습니다. 쿠폰 페이지의 https 주소를 그대로 붙여넣어 주세요.",
          launchPromoFree: promoFree,
          renewEventId: renewing?.id,
        }),
        400,
      );
    }

    if (form.get("agree_legal") === null) {
      return c.html(
        renderEventForm({
          values,
          contact,
          error: "이용약관, 개인정보처리방침, 환불·취소 정책에 동의해야 등록할 수 있습니다.",
          launchPromoFree: promoFree,
          renewEventId: renewing?.id,
        }),
        400,
      );
    }

    const imageEntry = form.get("image");
    const newImage = imageEntry instanceof File && imageEntry.size > 0 ? imageEntry : null;
    if (!newImage && !renewing) {
      return c.html(
        renderEventForm({
          values,
          contact,
          error: "지도 꽃 핀에 표시할 대표 이미지를 등록해 주세요.",
          launchPromoFree: promoFree,
        }),
        400,
      );
    }

    // 연장 때 주소가 그대로면 저장된 좌표를 쓴다(Kakao 호출 절약).
    const geocode =
      renewing && values.address === renewing.address && renewing.lat !== null && renewing.lng !== null
        ? { refinedAddress: renewing.address, lat: renewing.lat, lng: renewing.lng }
        : await geocodeAddress(
            c.env.KAKAO_REST_API_KEY,
            c.env.KAKAO_LOCAL_BASE_URL,
            values.address,
          );
    if (!geocode) {
      return c.html(
        renderEventForm({
          values,
          contact,
          error:
            "주소에서 위치를 찾지 못했습니다. 도로명 주소로 다시 입력해 주세요.",
          launchPromoFree: promoFree,
          renewEventId: renewing?.id,
        }),
        400,
      );
    }

    let imageUrl: string | null = renewing?.image_url ?? null;
    const result = newImage
      ? await uploadEventImage(
          c.env.MERCHANT_IMAGES,
          baseUrl(c.env, c.req.url),
          session.merchantId,
          newImage,
        )
      : null;
    if (result && !result.ok) {
      const reason =
        result.reason === "size"
          ? "이미지 용량은 5MB 이하만 업로드할 수 있습니다."
          : result.reason === "type"
            ? "이미지는 JPG, PNG, WebP 형식만 지원합니다."
            : "이미지를 업로드하지 못했습니다. 잠시 후 다시 시도해 주세요.";
      return c.html(
        renderEventForm({
          values,
          contact,
          error: reason,
          launchPromoFree: promoFree,
          renewEventId: renewing?.id,
        }),
        400,
      );
    }
    if (result) imageUrl = result.url;

    await updateMerchantContact(c.env.DB, session.merchantId, contact);

    if (renewing) {
      const renewed = await renewMerchantEvent(c.env.DB, renewing.id, session.merchantId, {
        title: values.title,
        description: values.description,
        benefit: values.benefit,
        eventType: values.eventType,
        storeName: values.storeName,
        address: geocode.refinedAddress,
        lat: geocode.lat,
        lng: geocode.lng,
        startDate: normalizeDate(values.startDate),
        endDate: normalizeDate(values.endDate),
        imageUrl,
        couponUrl: couponLink?.url ?? null,
        sourceItemId: couponSourceItemId(couponLink),
      }).catch((error: unknown) => {
        if (String(error).includes("UNIQUE")) return null;
        throw error;
      });
      if (renewed === null) {
        return c.html(
          renderEventForm({
            values,
            contact,
            error: "이미 등록된 네이버 쿠폰 링크입니다. 등록한 이벤트 목록을 확인해 주세요.",
            launchPromoFree: promoFree,
            renewEventId: renewing.id,
          }),
          409,
        );
      }
      if (!renewed) {
        return c.html(
          renderMessage("연장/재등록 불가", "이벤트 상태가 변경되었습니다. 대시보드에서 다시 확인해 주세요."),
          409,
        );
      }
      return c.redirect(`/merchant/event/${renewing.id}/pay`);
    }

    const event = await createMerchantEvent(c.env.DB, {
      merchantId: session.merchantId,
      title: values.title,
      description: values.description,
      benefit: values.benefit,
      eventType: values.eventType,
      storeName: values.storeName,
      address: geocode.refinedAddress,
      lat: geocode.lat,
      lng: geocode.lng,
      startDate: normalizeDate(values.startDate),
      endDate: normalizeDate(values.endDate),
      imageUrl,
      couponUrl: couponLink?.url ?? null,
      sourceItemId: couponSourceItemId(couponLink),
    }).catch((error: unknown) => {
      // local_events의 UNIQUE(source, source_item_id)에 걸린 경우다.
      // 같은 쿠폰이 이미 등록돼 있다는 뜻이므로 500 대신 폼으로 돌려보낸다.
      if (String(error).includes("UNIQUE")) return null;
      throw error;
    });
    if (!event) {
      return c.html(
        renderEventForm({
          values,
          contact,
          error:
            "이미 등록된 네이버 쿠폰 링크입니다. 등록한 이벤트 목록을 확인해 주세요.",
          launchPromoFree: promoFree,
        }),
        409,
      );
    }

    if (c.env.SLACK_DAILY_REPORT_WEBHOOK_URL) {
      // Fast path does not spend a Queue operation. Only a Slack failure enters the
      // existing retry queue, so normal registrations remain immediate and cheap.
      c.executionCtx.waitUntil(
        sendMerchantEventCreatedSlackCard(c.env, event).catch(async (error) => {
          console.error(JSON.stringify({
            event: "merchant_event_slack_immediate_failed",
            eventId: event.id,
            message: error instanceof Error ? error.message : String(error),
          }));
          if (!c.env.BACKGROUND_QUEUE) return;
          try {
            await c.env.BACKGROUND_QUEUE.send({
              type: "merchant-event-slack",
              eventId: event.id,
            });
          } catch (queueError) {
            // The event is already safely stored. A notification outage must not make
            // the merchant resubmit the form and create a duplicate event.
            console.error(JSON.stringify({
              event: "merchant_event_slack_enqueue_failed",
              eventId: event.id,
              message: queueError instanceof Error ? queueError.message : String(queueError),
            }));
          }
        }),
      );
    }

    return c.redirect(`/merchant/event/${event.id}/pay`);
  });

  app.get("/images/:key{.+}", async (c) => {
    const bucket = c.env.MERCHANT_IMAGES;
    if (!bucket) return c.notFound();
    const object = await bucket.get(c.req.param("key"));
    if (!object) return c.notFound();
    return c.body(object.body as unknown as ReadableStream, 200, {
      "Content-Type":
        object.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  });

  app.get("/event/:id", async (c) => {
    const session = await loadSession(c.env, c.req.header("cookie"));
    if (!session) return c.redirect("/merchant");
    const event = await getMerchantEventById(c.env.DB, c.req.param("id"));
    if (!event || event.merchant_id !== session.merchantId) {
      return c.html(
        renderMessage("이벤트를 찾을 수 없음", "다시 시도해 주세요."),
        404,
      );
    }
    return c.html(renderEventDetail(event));
  });

  app.post("/event/:id/withdraw", async (c) => {
    const session = await loadSession(c.env, c.req.header("cookie"));
    if (!session) return c.redirect("/merchant");
    const form = await c.req.formData().catch(() => null);
    if (!form || form.get("confirmation") !== "withdraw") {
      return c.html(
        renderMessage("확인이 필요함", "주의사항을 확인한 뒤 이벤트를 내려 주세요."),
        400,
      );
    }
    const event = await getMerchantEventById(c.env.DB, c.req.param("id"));
    if (!event || event.merchant_id !== session.merchantId) {
      return c.html(
        renderMessage("이벤트를 찾을 수 없음", "다시 시도해 주세요."),
        404,
      );
    }
    if (event.status === "expired" && event.rejection_reason === MERCHANT_WITHDRAWAL_REASON) {
      return c.redirect("/merchant/dashboard", 303);
    }
    if (event.status !== "approved") {
      return c.html(
        renderMessage("게시 종료 불가", "현재 게시 중인 이벤트만 내릴 수 있습니다."),
        409,
      );
    }
    const withdrawn = await withdrawMerchantEvent(
      c.env.DB,
      event.id,
      session.merchantId,
    );
    if (!withdrawn) {
      return c.html(
        renderMessage("게시 종료 실패", "이벤트 상태가 변경되었습니다. 다시 확인해 주세요."),
        409,
      );
    }
    return c.redirect("/merchant/dashboard", 303);
  });

  app.get("/event/:id/pay", async (c) => {
    const session = await loadSession(c.env, c.req.header("cookie"));
    if (!session) return c.redirect("/merchant");
    const event = await getMerchantEventById(c.env.DB, c.req.param("id"));
    if (!event || event.merchant_id !== session.merchantId) {
      return c.html(
        renderMessage("이벤트를 찾을 수 없음", "다시 시도해 주세요."),
        404,
      );
    }
    if (event.status === "approved") {
      return c.redirect("/merchant/dashboard");
    }
    if (launchPromoEnabled(c.env)) {
      return c.html(renderFreeClaim({ event }));
    }
    const clientKey = c.env.TOSS_CLIENT_KEY;
    if (!clientKey) {
      return c.html(
        renderMessage(
          "결제 모듈 준비 중",
          "결제 모듈이 아직 구성되지 않았습니다. 관리자에게 문의해 주세요.",
        ),
        503,
      );
    }
    const merchant = await getMerchantById(c.env.DB, session.merchantId);
    const customerName = merchant?.display_name ?? "고객";
    const base = baseUrl(c.env, c.req.url);
    return c.html(
      renderTossPayment({
        event,
        clientKey,
        customerKey: `merchant_${session.merchantId}`,
        amount: EVENT_PRICE_KRW,
        successUrl: `${base}/merchant/event/${event.id}/payment/success`,
        failUrl: `${base}/merchant/event/${event.id}/payment/fail`,
        customerName,
      }),
    );
  });

  app.post("/event/:id/claim-free", async (c) => {
    if (!launchPromoEnabled(c.env)) {
      return c.html(
        renderMessage(
          "무료 등록 불가",
          "오픈 기념 프로모션이 종료되었습니다. 다시 결제 단계로 이동해 주세요.",
        ),
        403,
      );
    }
    const session = await loadSession(c.env, c.req.header("cookie"));
    if (!session) return c.redirect("/merchant");
    const event = await getMerchantEventById(c.env.DB, c.req.param("id"));
    if (!event || event.merchant_id !== session.merchantId) {
      return c.html(
        renderMessage("이벤트를 찾을 수 없음", "다시 시도해 주세요."),
        404,
      );
    }
    if (event.status === "approved") {
      return c.redirect("/merchant/dashboard");
    }
    if (event.status !== "pending_payment") {
      return c.html(
        renderMessage(
          "등록 불가",
          "이 이벤트는 무료 등록 대상 상태가 아닙니다.",
        ),
        400,
      );
    }
    const period = resolveApprovalPeriod(event, new Date(), FREE_REGISTRATION_LAST_DAY);
    await markEventApproved(c.env.DB, {
      id: event.id,
      paymentKey: "free_launch_promo",
      paymentAmount: 0,
      ...period,
    });
    return c.redirect("/merchant/dashboard");
  });

  app.get("/event/:id/payment/success", async (c) => {
    const session = await loadSession(c.env, c.req.header("cookie"));
    if (!session) return c.redirect("/merchant");
    const event = await getMerchantEventById(c.env.DB, c.req.param("id"));
    if (!event || event.merchant_id !== session.merchantId) {
      return c.html(
        renderMessage("이벤트를 찾을 수 없음", "다시 시도해 주세요."),
        404,
      );
    }
    if (event.status === "approved") {
      return c.redirect("/merchant/dashboard");
    }
    const paymentKey = c.req.query("paymentKey");
    const orderId = c.req.query("orderId");
    const amountRaw = c.req.query("amount");
    const amount = Number(amountRaw);
    if (
      !paymentKey ||
      // 결제마다 orderId가 달라야 해서 `${event.id}_<시각>`으로 보낸다(renderTossPayment).
      !orderId?.startsWith(`${event.id}_`) ||
      !Number.isFinite(amount) ||
      amount !== EVENT_PRICE_KRW
    ) {
      return c.html(
        renderPaymentFail({
          event,
          code: "invalid_callback",
          message: "결제 응답을 검증하지 못했습니다.",
        }),
        400,
      );
    }
    if (!c.env.TOSS_SECRET_KEY) {
      return c.html(
        renderPaymentFail({
          event,
          code: "secret_missing",
          message: "결제 모듈이 구성되지 않았습니다.",
        }),
        503,
      );
    }
    const result = await confirmTossPayment({
      secretKey: c.env.TOSS_SECRET_KEY,
      paymentKey,
      orderId,
      amount,
    });
    if (!result.ok) {
      console.error("toss confirm failed", result.code, result.message);
      return c.html(
        renderPaymentFail({
          event,
          code: result.code,
          message: result.message,
        }),
        400,
      );
    }
    const period = resolveApprovalPeriod(event, new Date());
    await markEventApproved(c.env.DB, {
      id: event.id,
      paymentKey: result.payment.paymentKey,
      paymentAmount: result.payment.totalAmount,
      ...period,
    });
    return c.redirect("/merchant/dashboard");
  });

  app.get("/event/:id/payment/fail", async (c) => {
    const session = await loadSession(c.env, c.req.header("cookie"));
    if (!session) return c.redirect("/merchant");
    const event = await getMerchantEventById(c.env.DB, c.req.param("id"));
    if (!event || event.merchant_id !== session.merchantId) {
      return c.html(
        renderMessage("이벤트를 찾을 수 없음", "다시 시도해 주세요."),
        404,
      );
    }
    return c.html(
      renderPaymentFail({
        event,
        code: c.req.query("code") ?? undefined,
        message: c.req.query("message") ?? undefined,
      }),
      400,
    );
  });

  // 관리자 영역. 관리자가 아니면 존재 자체를 드러내지 않도록 404로 답한다.
  const loadAdmin = async (env: MerchantEnv, cookie: string | undefined) => {
    const session = await loadSession(env, cookie);
    return session && isMerchantAdmin(env, session.merchantId) ? session : null;
  };

  app.get("/admin", async (c) => {
    if (!(await loadAdmin(c.env, c.req.header("cookie")))) return c.notFound();
    return c.html(renderAdminList(await listAllMerchantEvents(c.env.DB)));
  });

  app.get("/admin/event/:id", async (c) => {
    if (!(await loadAdmin(c.env, c.req.header("cookie")))) return c.notFound();
    const event = await getAdminMerchantEvent(c.env.DB, c.req.param("id"));
    if (!event) return c.notFound();
    return c.html(renderAdminEventDetail({ event }));
  });

  app.post("/admin/event/:id/edit", async (c) => {
    const admin = await loadAdmin(c.env, c.req.header("cookie"));
    if (!admin) return c.notFound();
    const event = await getAdminMerchantEvent(c.env.DB, c.req.param("id"));
    if (!event) return c.notFound();
    const form = await c.req.formData();
    const values: EventFormValues = {
      title: String(form.get("title") ?? "").trim(),
      description: String(form.get("description") ?? "").trim(),
      benefit: String(form.get("benefit") ?? "").trim(),
      eventType: parseEventType(String(form.get("event_type") ?? "")),
      storeName: String(form.get("store_name") ?? "").trim(),
      address: String(form.get("address") ?? "").trim(),
      couponUrl: String(form.get("coupon_url") ?? "").trim(),
      startDate: String(form.get("start_date") ?? "").trim(),
      endDate: String(form.get("end_date") ?? "").trim(),
    };
    const fail = (error: string, status: 400 | 409) =>
      c.html(renderAdminEventDetail({ event, values, error }), status);

    const missing = (
      ["title", "description", "benefit", "storeName", "address"] as const
    ).filter((key) => !values[key]);
    if (missing.length > 0) return fail("필수 항목을 모두 입력해 주세요.", 400);

    // 비운 날짜는 기존 값을 유지한다. 지난 종료일도 관리자는 그대로 둘 수 있어야 하므로
    // 오늘 기준 검사는 하지 않는다.
    const startDate = normalizeDate(values.startDate) ?? event.start_date;
    const endDate = normalizeDate(values.endDate) ?? event.end_date;
    const periodError = validateEventPeriod(startDate ?? "", endDate ?? "", "");
    if (periodError) return fail(periodError, 400);

    const couponLink = parseNaverCouponLink(values.couponUrl);
    if (couponLink === undefined) {
      return fail("네이버 쿠폰 링크는 네이버 예약·플레이스 주소만 등록할 수 있습니다.", 400);
    }

    let address = event.address;
    let lat = event.lat;
    let lng = event.lng;
    if (values.address !== event.address) {
      const geocode = await geocodeAddress(
        c.env.KAKAO_REST_API_KEY,
        c.env.KAKAO_LOCAL_BASE_URL,
        values.address,
      );
      if (!geocode) return fail("주소에서 위치를 찾지 못했습니다. 도로명 주소로 다시 입력해 주세요.", 400);
      address = geocode.refinedAddress;
      lat = geocode.lat;
      lng = geocode.lng;
    }

    let imageUrl = event.image_url;
    const imageEntry = form.get("image");
    if (imageEntry instanceof File && imageEntry.size > 0) {
      const result = await uploadEventImage(
        c.env.MERCHANT_IMAGES,
        baseUrl(c.env, c.req.url),
        event.merchant_id ?? admin.merchantId,
        imageEntry,
      );
      if (!result.ok) {
        return fail(
          result.reason === "size"
            ? "이미지 용량은 5MB 이하만 업로드할 수 있습니다."
            : result.reason === "type"
              ? "이미지는 JPG, PNG, WebP 형식만 지원합니다."
              : "이미지를 업로드하지 못했습니다. 잠시 후 다시 시도해 주세요.",
          400,
        );
      }
      imageUrl = result.url;
    }

    const updated = await adminUpdateMerchantEvent(c.env.DB, event.id, {
      title: values.title,
      description: values.description,
      benefit: values.benefit,
      eventType: values.eventType,
      storeName: values.storeName,
      address,
      lat,
      lng,
      startDate,
      endDate,
      imageUrl,
      couponUrl: couponLink?.url ?? null,
      sourceItemId: couponSourceItemId(couponLink),
    }).catch((error: unknown) => {
      if (String(error).includes("UNIQUE")) return null;
      throw error;
    });
    if (updated === null) return fail("다른 이벤트에 이미 등록된 네이버 쿠폰 링크입니다.", 409);
    logAdminAction("edit", event.id, admin.merchantId);
    return c.redirect(`/merchant/admin/event/${event.id}`, 303);
  });

  app.post("/admin/event/:id/hide", async (c) => {
    const admin = await loadAdmin(c.env, c.req.header("cookie"));
    if (!admin) return c.notFound();
    const form = await c.req.formData().catch(() => null);
    const reason = String(form?.get("reason") ?? "").trim().slice(0, 300);
    if (!form || form.get("confirmation") !== "hide" || !reason) {
      return c.html(
        renderMessage("확인이 필요함", "숨기는 사유를 입력하고 확인 버튼을 눌러 주세요."),
        400,
      );
    }
    const id = c.req.param("id");
    if (!(await adminHideMerchantEvent(c.env.DB, id, reason))) {
      return c.html(renderMessage("숨길 수 없음", "이미 숨겼거나 없는 이벤트입니다."), 409);
    }
    logAdminAction("hide", id, admin.merchantId, reason);
    return c.redirect(`/merchant/admin/event/${id}`, 303);
  });

  app.post("/admin/event/:id/publish", async (c) => {
    const admin = await loadAdmin(c.env, c.req.header("cookie"));
    if (!admin) return c.notFound();
    const id = c.req.param("id");
    if (!(await adminPublishMerchantEvent(c.env.DB, id))) {
      return c.html(
        renderMessage("다시 게시할 수 없음", "숨겼거나 종료된 이벤트 중 결제·무료 등록을 마친 것만 다시 게시할 수 있습니다."),
        409,
      );
    }
    logAdminAction("publish", id, admin.merchantId);
    return c.redirect(`/merchant/admin/event/${id}`, 303);
  });

  return app;
}
