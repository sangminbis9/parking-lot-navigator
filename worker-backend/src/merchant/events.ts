import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type UploadImageResult =
  | { ok: true; key: string; url: string }
  | { ok: false; reason: "type" | "size" | "missing" | "store_failed" };

export async function uploadEventImage(
  bucket: R2Bucket | undefined,
  publicBaseUrl: string,
  merchantId: string,
  file: File,
): Promise<UploadImageResult> {
  if (!bucket) return { ok: false, reason: "store_failed" };
  if (!file.size) return { ok: false, reason: "missing" };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, reason: "size" };
  const ext = ALLOWED_IMAGE_TYPES[file.type.toLowerCase()];
  if (!ext) return { ok: false, reason: "type" };

  const random = crypto.randomUUID().replace(/-/g, "");
  const key = `events/${merchantId}/${random}.${ext}`;
  try {
    await bucket.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    });
  } catch (error) {
    console.error("merchant image upload failed", error);
    return { ok: false, reason: "store_failed" };
  }
  const base = publicBaseUrl.replace(/\/$/, "");
  return { ok: true, key, url: `${base}/merchant/images/${key}` };
}

export type MerchantEventStatus =
  | "pending"
  | "pending_payment"
  | "approved"
  | "rejected"
  | "expired";

export type MerchantEventType =
  | "discount"
  | "freebie"
  | "review_event"
  | "popup"
  | "limited_menu"
  | "opening_event"
  | "etc";

export type MerchantEventRow = {
  id: string;
  merchant_id: string | null;
  title: string;
  description: string | null;
  benefit: string | null;
  event_type: MerchantEventType;
  status: MerchantEventStatus;
  store_name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  start_date: string | null;
  end_date: string | null;
  image_url: string | null;
  paid_until: string | null;
  payment_key: string | null;
  payment_amount: number | null;
  created_at: string;
  updated_at: string;
};

export type CreateMerchantEventInput = {
  merchantId: string;
  title: string;
  description: string;
  benefit: string;
  eventType: MerchantEventType;
  storeName: string;
  address: string;
  lat: number | null;
  lng: number | null;
  startDate: string | null;
  endDate: string | null;
  imageUrl: string | null;
};

export async function createMerchantEvent(
  db: D1Database,
  input: CreateMerchantEventInput,
): Promise<MerchantEventRow> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const duplicateKey = `merchant:${input.merchantId}:${id}`;
  await db
    .prepare(
      `INSERT INTO local_events (
        id, title, description, benefit, event_type, status, source,
        image_url, store_name, address, lat, lng, start_date, end_date,
        needs_review, is_sponsored, priority_score, duplicate_key,
        merchant_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pending_payment', 'merchant',
        ?, ?, ?, ?, ?, ?, ?,
        0, 1, 100, ?,
        ?, ?, ?)`,
    )
    .bind(
      id,
      input.title,
      input.description,
      input.benefit,
      input.eventType,
      input.imageUrl,
      input.storeName,
      input.address,
      input.lat,
      input.lng,
      input.startDate,
      input.endDate,
      duplicateKey,
      input.merchantId,
      now,
      now,
    )
    .run();
  const row = await getMerchantEventById(db, id);
  if (!row) throw new Error("merchant_event_insert_failed");
  return row;
}

export async function getMerchantEventById(
  db: D1Database,
  id: string,
): Promise<MerchantEventRow | null> {
  return await db
    .prepare(
      `SELECT id, merchant_id, title, description, benefit, event_type, status,
              store_name, address, lat, lng, start_date, end_date, image_url,
              paid_until, payment_key, payment_amount, created_at, updated_at
       FROM local_events WHERE id = ? LIMIT 1`,
    )
    .bind(id)
    .first<MerchantEventRow>();
}

export async function listMerchantEvents(
  db: D1Database,
  merchantId: string,
): Promise<MerchantEventRow[]> {
  const result = await db
    .prepare(
      `SELECT id, merchant_id, title, description, benefit, event_type, status,
              store_name, address, lat, lng, start_date, end_date, image_url,
              paid_until, payment_key, payment_amount, created_at, updated_at
       FROM local_events
       WHERE merchant_id = ?
       ORDER BY created_at DESC`,
    )
    .bind(merchantId)
    .all<MerchantEventRow>();
  return result.results ?? [];
}

export type GeocodeResult = {
  lat: number;
  lng: number;
  refinedAddress: string;
};

export async function geocodeAddress(
  apiKey: string | undefined,
  baseUrl: string | undefined,
  address: string,
): Promise<GeocodeResult | null> {
  if (!apiKey) return null;
  const trimmed = address.trim();
  if (!trimmed) return null;
  const root = (baseUrl ?? "https://dapi.kakao.com").replace(/\/$/, "");
  const url = new URL("/v2/local/search/address.json", root);
  url.searchParams.set("query", trimmed);
  url.searchParams.set("size", "1");
  const resp = await fetch(url.toString(), {
    headers: { Authorization: `KakaoAK ${apiKey}` },
  });
  if (!resp.ok) return null;
  const body = (await resp.json()) as {
    documents?: Array<{
      x?: string;
      y?: string;
      address_name?: string;
      road_address?: { address_name?: string };
    }>;
  };
  const doc = body.documents?.[0];
  if (!doc?.x || !doc?.y) {
    const kw = await geocodeKeyword(apiKey, root, trimmed);
    return kw;
  }
  const lng = Number(doc.x);
  const lat = Number(doc.y);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat,
    lng,
    refinedAddress:
      doc.road_address?.address_name ?? doc.address_name ?? trimmed,
  };
}

async function geocodeKeyword(
  apiKey: string,
  root: string,
  query: string,
): Promise<GeocodeResult | null> {
  const url = new URL("/v2/local/search/keyword.json", root);
  url.searchParams.set("query", query);
  url.searchParams.set("size", "1");
  const resp = await fetch(url.toString(), {
    headers: { Authorization: `KakaoAK ${apiKey}` },
  });
  if (!resp.ok) return null;
  const body = (await resp.json()) as {
    documents?: Array<{
      x?: string;
      y?: string;
      road_address_name?: string;
      address_name?: string;
    }>;
  };
  const doc = body.documents?.[0];
  if (!doc?.x || !doc?.y) return null;
  const lng = Number(doc.x);
  const lat = Number(doc.y);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat,
    lng,
    refinedAddress: doc.road_address_name ?? doc.address_name ?? query,
  };
}
