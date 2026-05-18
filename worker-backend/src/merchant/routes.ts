import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { D1Database } from "@cloudflare/workers-types";
import {
  buildKakaoAuthorizeUrl,
  buildNaverAuthorizeUrl,
  callbackPath,
  exchangeKakaoCode,
  exchangeNaverCode,
} from "./oauth.js";
import { renderDashboard, renderLanding, renderMessage } from "./pages.js";
import { getMerchantById, upsertMerchant } from "./store.js";
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
  NAVER_CLIENT_ID?: string;
  NAVER_CLIENT_SECRET?: string;
  KAKAO_REST_API_KEY?: string;
  KAKAO_CLIENT_SECRET?: string;
  MERCHANT_SESSION_SECRET?: string;
  MERCHANT_PUBLIC_BASE_URL?: string;
};

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
    return c.html(renderDashboard(merchant));
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
      renderMessage("준비 중", "이벤트 등록 폼은 다음 단계에서 활성화됩니다."),
    );
  });

  return app;
}
