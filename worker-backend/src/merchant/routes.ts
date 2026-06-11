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
  renderDashboard,
  renderEventForm,
  renderFreeClaim,
  renderLanding,
  renderMessage,
  renderPaymentFail,
  renderTossPayment,
  type EventFormValues,
} from "./pages.js";
import { getMerchantById, upsertMerchant } from "./store.js";
import {
  createMerchantEvent,
  geocodeAddress,
  getMerchantEventById,
  listMerchantEvents,
  markEventApproved,
  uploadEventImage,
  type MerchantEventType,
} from "./events.js";
import { addMonths, confirmTossPayment } from "./toss.js";
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
  MERCHANT_PUBLIC_BASE_URL?: string;
  TOSS_CLIENT_KEY?: string;
  TOSS_SECRET_KEY?: string;
  MERCHANT_LAUNCH_PROMO_FREE?: string;
};

const EVENT_PRICE_KRW = 10000;
const EVENT_DURATION_MONTHS = 3;

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
    return c.html(renderDashboard(merchant, events));
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
    return c.html(
      renderEventForm({
        values: EMPTY_FORM,
        launchPromoFree: launchPromoEnabled(c.env),
      }),
    );
  });

  app.post("/event/new", async (c) => {
    const session = await loadSession(c.env, c.req.header("cookie"));
    if (!session) return c.redirect("/merchant");
    const form = await c.req.formData();
    const values: EventFormValues = {
      title: String(form.get("title") ?? "").trim(),
      description: String(form.get("description") ?? "").trim(),
      benefit: String(form.get("benefit") ?? "").trim(),
      eventType: parseEventType(String(form.get("event_type") ?? "")),
      storeName: String(form.get("store_name") ?? "").trim(),
      address: String(form.get("address") ?? "").trim(),
      startDate: String(form.get("start_date") ?? "").trim(),
      endDate: String(form.get("end_date") ?? "").trim(),
    };

    const missing = (
      ["title", "description", "benefit", "storeName", "address"] as const
    ).filter((key) => !values[key]);
    const promoFree = launchPromoEnabled(c.env);
    if (missing.length > 0) {
      return c.html(
        renderEventForm({
          values,
          error: "필수 항목을 모두 입력해 주세요.",
          launchPromoFree: promoFree,
        }),
        400,
      );
    }

    if (form.get("agree_legal") === null) {
      return c.html(
        renderEventForm({
          values,
          error: "이용약관, 개인정보처리방침, 환불·취소 정책에 동의해야 등록할 수 있습니다.",
          launchPromoFree: promoFree,
        }),
        400,
      );
    }

    const geocode = await geocodeAddress(
      c.env.KAKAO_REST_API_KEY,
      c.env.KAKAO_LOCAL_BASE_URL,
      values.address,
    );
    if (!geocode) {
      return c.html(
        renderEventForm({
          values,
          error:
            "주소에서 위치를 찾지 못했습니다. 도로명 주소로 다시 입력해 주세요.",
          launchPromoFree: promoFree,
        }),
        400,
      );
    }

    let imageUrl: string | null = null;
    const imageEntry = form.get("image");
    if (imageEntry instanceof File && imageEntry.size > 0) {
      const result = await uploadEventImage(
        c.env.MERCHANT_IMAGES,
        baseUrl(c.env, c.req.url),
        session.merchantId,
        imageEntry,
      );
      if (!result.ok) {
        const reason =
          result.reason === "size"
            ? "이미지 용량은 5MB 이하만 업로드할 수 있습니다."
            : result.reason === "type"
              ? "이미지는 JPG, PNG, WebP 형식만 지원합니다."
              : "이미지를 업로드하지 못했습니다. 잠시 후 다시 시도해 주세요.";
        return c.html(
          renderEventForm({
            values,
            error: reason,
            launchPromoFree: promoFree,
          }),
          400,
        );
      }
      imageUrl = result.url;
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
    });

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
    const startDate = event.start_date ?? new Date().toISOString().slice(0, 10);
    const paidUntil = addMonths(
      new Date(`${startDate}T00:00:00Z`),
      EVENT_DURATION_MONTHS,
    )
      .toISOString()
      .slice(0, 10);
    await markEventApproved(c.env.DB, {
      id: event.id,
      paymentKey: "free_launch_promo",
      paymentAmount: 0,
      paidUntil,
      startDate,
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
      orderId !== event.id ||
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
    const startDate = event.start_date ?? new Date().toISOString().slice(0, 10);
    const paidUntil = addMonths(
      new Date(`${startDate}T00:00:00Z`),
      EVENT_DURATION_MONTHS,
    )
      .toISOString()
      .slice(0, 10);
    await markEventApproved(c.env.DB, {
      id: event.id,
      paymentKey: result.payment.paymentKey,
      paymentAmount: result.payment.totalAmount,
      paidUntil,
      startDate,
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

  return app;
}
