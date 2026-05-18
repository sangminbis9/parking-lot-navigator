import type { MerchantProvider } from "./session.js";

export type MerchantProfile = {
  providerUserId: string;
  email: string | null;
  displayName: string | null;
};

export type OAuthProviderConfig = {
  clientId: string;
  clientSecret?: string;
};

export function buildNaverAuthorizeUrl(
  config: OAuthProviderConfig,
  redirectUri: string,
  state: string,
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: redirectUri,
    state,
  });
  return `https://nid.naver.com/oauth2.0/authorize?${params.toString()}`;
}

export function buildKakaoAuthorizeUrl(
  config: OAuthProviderConfig,
  redirectUri: string,
  state: string,
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: redirectUri,
    state,
  });
  return `https://kauth.kakao.com/oauth/authorize?${params.toString()}`;
}

export async function exchangeNaverCode(
  config: OAuthProviderConfig,
  code: string,
  state: string,
): Promise<MerchantProfile> {
  if (!config.clientSecret) throw new Error("naver_oauth_secret_missing");
  const tokenUrl = new URL("https://nid.naver.com/oauth2.0/token");
  tokenUrl.searchParams.set("grant_type", "authorization_code");
  tokenUrl.searchParams.set("client_id", config.clientId);
  tokenUrl.searchParams.set("client_secret", config.clientSecret);
  tokenUrl.searchParams.set("code", code);
  tokenUrl.searchParams.set("state", state);

  const tokenResp = await fetch(tokenUrl.toString(), { method: "POST" });
  if (!tokenResp.ok) throw new Error(`naver_token_http_${tokenResp.status}`);
  const tokenJson = (await tokenResp.json()) as {
    access_token?: string;
    error?: string;
  };
  if (!tokenJson.access_token) {
    throw new Error(`naver_token_error_${tokenJson.error ?? "unknown"}`);
  }

  const meResp = await fetch("https://openapi.naver.com/v1/nid/me", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  if (!meResp.ok) throw new Error(`naver_me_http_${meResp.status}`);
  const meJson = (await meResp.json()) as {
    resultcode?: string;
    response?: {
      id?: string;
      email?: string;
      name?: string;
      nickname?: string;
    };
  };
  const res = meJson.response;
  if (meJson.resultcode !== "00" || !res?.id) {
    throw new Error(`naver_me_error_${meJson.resultcode ?? "unknown"}`);
  }
  return {
    providerUserId: res.id,
    email: res.email ?? null,
    displayName: res.name ?? res.nickname ?? null,
  };
}

export async function exchangeKakaoCode(
  config: OAuthProviderConfig,
  code: string,
  redirectUri: string,
): Promise<MerchantProfile> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    redirect_uri: redirectUri,
    code,
  });
  if (config.clientSecret) body.set("client_secret", config.clientSecret);

  const tokenResp = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!tokenResp.ok) throw new Error(`kakao_token_http_${tokenResp.status}`);
  const tokenJson = (await tokenResp.json()) as {
    access_token?: string;
    error?: string;
  };
  if (!tokenJson.access_token) {
    throw new Error(`kakao_token_error_${tokenJson.error ?? "unknown"}`);
  }

  const meResp = await fetch("https://kapi.kakao.com/v2/user/me", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  if (!meResp.ok) throw new Error(`kakao_me_http_${meResp.status}`);
  const meJson = (await meResp.json()) as {
    id?: number;
    kakao_account?: {
      email?: string;
      profile?: { nickname?: string };
    };
  };
  if (typeof meJson.id !== "number") throw new Error("kakao_me_no_id");
  return {
    providerUserId: String(meJson.id),
    email: meJson.kakao_account?.email ?? null,
    displayName: meJson.kakao_account?.profile?.nickname ?? null,
  };
}

export function callbackPath(provider: MerchantProvider): string {
  return `/merchant/auth/${provider}/callback`;
}
