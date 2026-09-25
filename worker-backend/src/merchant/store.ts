import type { D1Database } from "@cloudflare/workers-types";
import type { MerchantProvider } from "./session.js";
import type { MerchantProfile } from "./oauth.js";

export type MerchantRow = {
  id: string;
  provider: MerchantProvider;
  provider_user_id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  contact_name: string | null;
  contact_email: string | null;
  created_at: string;
  updated_at: string;
};

export async function upsertMerchant(
  db: D1Database,
  provider: MerchantProvider,
  profile: MerchantProfile,
): Promise<MerchantRow> {
  const now = new Date().toISOString();
  const existing = await db
    .prepare(
      "SELECT * FROM merchants WHERE provider = ? AND provider_user_id = ? LIMIT 1",
    )
    .bind(provider, profile.providerUserId)
    .first<MerchantRow>();

  if (existing) {
    await db
      .prepare(
        "UPDATE merchants SET display_name = COALESCE(?, display_name), email = COALESCE(?, email), updated_at = ? WHERE id = ?",
      )
      .bind(profile.displayName, profile.email, now, existing.id)
      .run();
    return {
      ...existing,
      display_name: profile.displayName ?? existing.display_name,
      email: profile.email ?? existing.email,
      updated_at: now,
    };
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO merchants (id, provider, provider_user_id, display_name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      id,
      provider,
      profile.providerUserId,
      profile.displayName,
      profile.email,
      now,
      now,
    )
    .run();
  return {
    id,
    provider,
    provider_user_id: profile.providerUserId,
    display_name: profile.displayName,
    email: profile.email,
    phone: null,
    contact_name: null,
    contact_email: null,
    created_at: now,
    updated_at: now,
  };
}

export async function getMerchantById(
  db: D1Database,
  id: string,
): Promise<MerchantRow | null> {
  return await db
    .prepare("SELECT * FROM merchants WHERE id = ? LIMIT 1")
    .bind(id)
    .first<MerchantRow>();
}

/** 등록자 연락처. phone은 normalizeKoreanPhone을 거친 하이픈 형식이어야 한다. */
export async function updateMerchantContact(
  db: D1Database,
  id: string,
  contact: { name: string; phone: string; email: string },
): Promise<void> {
  await db
    .prepare(
      "UPDATE merchants SET contact_name = ?, phone = ?, contact_email = ?, updated_at = ? WHERE id = ?",
    )
    .bind(contact.name, contact.phone, contact.email, new Date().toISOString(), id)
    .run();
}

/**
 * 숫자만 남겨 한국 전화번호 형식(010-0000-0000, 02-000-0000, 1588-0000)으로 맞춘다.
 * 형식에 맞지 않으면 null. 폼의 입력 중 자동 하이픈(pages.ts)과 같은 규칙이다.
 */
export function normalizeKoreanPhone(input: string): string | null {
  const d = input.replace(/\D/g, "");
  if (/^02\d{7,8}$/.test(d)) {
    return `02-${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
  }
  if (/^0[13-9]\d{8,9}$/.test(d)) {
    return `${d.slice(0, 3)}-${d.slice(3, d.length - 4)}-${d.slice(-4)}`;
  }
  if (/^1[568]\d{6}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return null;
}
