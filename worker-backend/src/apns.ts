// APNs 발송. Worker에는 Node의 jsonwebtoken이 없으므로 WebCrypto로 ES256 JWT를 직접 만든다.
// provider token은 최대 1시간 유효해서 모듈 스코프에 캐시하고, 55분마다 새로 만든다.

export type ApnsResult = {
  ok: boolean;
  status: number;
  reason?: string;
  /** APNs가 돌려주는 발송 식별자. 중복 신고가 들어왔을 때 로그로 추적할 유일한 값이다. */
  apnsId?: string;
};

export type ApnsPayload = {
  title: string;
  body: string;
  threadId?: string;
  /**
   * apns-collapse-id. 같은 값으로 두 번 도착하면 APNs가 기기에서 하나로 합친다.
   * 서버 중복 방지가 뚫렸을 때의 마지막 방어선이지 그것만으로 충분한 장치는 아니다.
   * 64바이트를 넘으면 APNs가 400을 주므로 호출자가 그 안에서 만들어야 한다.
   */
  collapseId?: string;
  /** aps 밖에 실려 앱이 딥링크에 쓰는 값. */
  data: Record<string, string>;
};

/** 테스트에서 갈아 끼울 수 있게 인터페이스로 둔다. 실제 발송은 createApnsSender가 만든다. */
export interface ApnsSender {
  send(
    deviceToken: string,
    environment: string,
    payload: ApnsPayload,
  ): Promise<ApnsResult>;
}

export type ApnsConfig = {
  keyId: string;
  teamId: string;
  privateKeyPem: string;
  bundleId: string;
};

export function apnsConfigFromEnv(env: {
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_PRIVATE_KEY?: string;
  APNS_BUNDLE_ID?: string;
}): ApnsConfig | null {
  const { APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY, APNS_BUNDLE_ID } = env;
  if (!APNS_KEY_ID || !APNS_TEAM_ID || !APNS_PRIVATE_KEY || !APNS_BUNDLE_ID) {
    return null;
  }
  return {
    keyId: APNS_KEY_ID,
    teamId: APNS_TEAM_ID,
    privateKeyPem: APNS_PRIVATE_KEY,
    bundleId: APNS_BUNDLE_ID,
  };
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlEncodeText(text: string): string {
  return base64UrlEncode(new TextEncoder().encode(text));
}

/** "-----BEGIN PRIVATE KEY-----" PEM(.p8 파일 내용)에서 DER 바이트를 꺼낸다. */
function pemToDer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

let cachedToken: { value: string; issuedAt: number; keyId: string } | null = null;

export async function apnsProviderToken(config: ApnsConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (
    cachedToken &&
    cachedToken.keyId === config.keyId &&
    now - cachedToken.issuedAt < 55 * 60
  ) {
    return cachedToken.value;
  }
  const header = base64UrlEncodeText(
    JSON.stringify({ alg: "ES256", kid: config.keyId }),
  );
  const claims = base64UrlEncodeText(
    JSON.stringify({ iss: config.teamId, iat: now }),
  );
  const signingInput = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(config.privateKeyPem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput),
  );
  const token = `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
  cachedToken = { value: token, issuedAt: now, keyId: config.keyId };
  return token;
}

export function createApnsSender(config: ApnsConfig): ApnsSender {
  return {
    async send(deviceToken, environment, payload) {
      const host =
        environment === "sandbox"
          ? "api.sandbox.push.apple.com"
          : "api.push.apple.com";
      const jwt = await apnsProviderToken(config);
      const body = JSON.stringify({
        aps: {
          alert: { title: payload.title, body: payload.body },
          sound: "default",
          "thread-id": payload.threadId,
        },
        ...payload.data,
      });
      const headers: Record<string, string> = {
        authorization: `bearer ${jwt}`,
        "apns-topic": config.bundleId,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
      };
      if (payload.collapseId) headers["apns-collapse-id"] = payload.collapseId;
      const response = await fetch(`https://${host}/3/device/${deviceToken}`, {
        method: "POST",
        headers,
        body,
      });
      const apnsId = response.headers.get("apns-id") ?? undefined;
      if (response.status === 200) return { ok: true, status: 200, apnsId };
      let reason: string | undefined;
      try {
        const parsed = (await response.json()) as { reason?: string };
        reason = parsed?.reason;
      } catch {
        reason = undefined;
      }
      return { ok: false, status: response.status, reason, apnsId };
    },
  };
}

/** 더 이상 유효하지 않은 토큰. 이 응답을 받으면 저장된 토큰을 지운다. */
export function isPermanentTokenFailure(result: ApnsResult): boolean {
  if (result.status === 410) return true;
  return (
    result.status === 400 &&
    (result.reason === "BadDeviceToken" ||
      result.reason === "DeviceTokenNotForTopic")
  );
}
