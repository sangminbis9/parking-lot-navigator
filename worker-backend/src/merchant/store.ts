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
