import { logAgentActivity } from "./headAgent.js";

type ImageTargetKind = "local_event" | "discovery_item";

type ImageTargetRow = {
  target_kind: ImageTargetKind;
  id: string;
  title: string;
  source_url: string | null;
};

export type ImageEnrichmentEnv = {
  AGENT_PIXEL_ENABLED?: string;
  AGENT_PIXEL_BATCH_SIZE?: string;
};

export type ImageEnrichmentResult = {
  enabled: boolean;
  considered: number;
  enriched: number;
  skipped: number;
  errors: string[];
  generatedAt: string;
};

const DEFAULT_BATCH_SIZE = 12;
const MAX_BATCH_SIZE = 40;
const HTML_PREVIEW_BYTES = 240_000;

export async function runImageEnrichment(
  db: D1Database,
  env: ImageEnrichmentEnv,
): Promise<ImageEnrichmentResult> {
  const result: ImageEnrichmentResult = {
    enabled: pixelEnabled(env),
    considered: 0,
    enriched: 0,
    skipped: 0,
    errors: [],
    generatedAt: new Date().toISOString(),
  };
  if (!result.enabled) return result;

  const limit = clampInt(
    Number(env.AGENT_PIXEL_BATCH_SIZE ?? DEFAULT_BATCH_SIZE),
    1,
    MAX_BATCH_SIZE,
  );

  let targets: ImageTargetRow[] = [];
  try {
    const localEvents = await queryLocalEventTargets(db, limit);
    const remaining = Math.max(0, limit - localEvents.length);
    const discoveryItems =
      remaining > 0 ? await queryDiscoveryItemTargets(db, remaining) : [];
    targets = [...localEvents, ...discoveryItems];
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    result.errors.push(`pixel_query:${message.slice(0, 160)}`);
    return result;
  }

  result.considered = targets.length;
  for (const target of targets) {
    if (!target.source_url) {
      result.skipped += 1;
      await logImageSkip(db, target, "원문 URL 없음");
      continue;
    }

    let imageUrl: string | null = null;
    try {
      imageUrl = await findImageFromSource(target.source_url);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      result.errors.push(`pixel_fetch:${message.slice(0, 160)}`);
      await logAgentActivity(db, {
        agentId: "pixel",
        action: "image_error",
        targetKind: target.target_kind,
        targetId: target.id,
        targetTitle: target.title,
        reason: message.slice(0, 200),
      });
      continue;
    }

    if (!imageUrl) {
      result.skipped += 1;
      await logImageSkip(db, target, "원문 대표 이미지를 찾지 못함");
      continue;
    }

    try {
      const changed = await applyImageUrl(db, target, imageUrl);
      if (changed) {
        result.enriched += 1;
        await logAgentActivity(db, {
          agentId: "pixel",
          action: "image_enrich",
          targetKind: target.target_kind,
          targetId: target.id,
          targetTitle: target.title,
          reason: "원문 대표 이미지 보강",
          payload: { imageUrl },
        });
      } else {
        result.skipped += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      result.errors.push(`pixel_apply:${message.slice(0, 160)}`);
    }
  }

  return result;
}

async function queryLocalEventTargets(
  db: D1Database,
  limit: number,
): Promise<ImageTargetRow[]> {
  const rows = await db
    .prepare(
      `SELECT 'local_event' AS target_kind, id, title, source_url
         FROM local_events le
        WHERE le.status IN ('approved', 'pending')
          AND (le.image_url IS NULL OR trim(le.image_url) = '')
          AND le.source_url IS NOT NULL
          AND le.source_url LIKE 'http%'
          AND NOT EXISTS (
            SELECT 1 FROM agent_activity aa
             WHERE aa.target_id = le.id
               AND aa.agent_id = 'pixel'
               AND aa.action IN ('image_enrich', 'image_skip')
          )
        ORDER BY le.updated_at DESC
        LIMIT ?`,
    )
    .bind(limit)
    .all<ImageTargetRow>();
  return rows.results ?? [];
}

async function queryDiscoveryItemTargets(
  db: D1Database,
  limit: number,
): Promise<ImageTargetRow[]> {
  const rows = await db
    .prepare(
      `SELECT 'discovery_item' AS target_kind, id, title, source_url
         FROM discovery_items di
        WHERE (di.image_url IS NULL OR trim(di.image_url) = '')
          AND di.source_url IS NOT NULL
          AND di.source_url LIKE 'http%'
          AND NOT EXISTS (
            SELECT 1 FROM agent_activity aa
             WHERE aa.target_id = di.id
               AND aa.agent_id = 'pixel'
               AND aa.action IN ('image_enrich', 'image_skip')
          )
        ORDER BY di.last_seen_at DESC
        LIMIT ?`,
    )
    .bind(limit)
    .all<ImageTargetRow>();
  return rows.results ?? [];
}

async function applyImageUrl(
  db: D1Database,
  target: ImageTargetRow,
  imageUrl: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const result =
    target.target_kind === "local_event"
      ? await db
          .prepare(
            `UPDATE local_events
                SET image_url = ?, updated_at = ?
              WHERE id = ?
                AND (image_url IS NULL OR trim(image_url) = '')`,
          )
          .bind(imageUrl, now, target.id)
          .run()
      : await db
          .prepare(
            `UPDATE discovery_items
                SET image_url = ?, data_updated_at = ?
              WHERE id = ?
                AND (image_url IS NULL OR trim(image_url) = '')`,
          )
          .bind(imageUrl, now, target.id)
          .run();
  return (result.meta.changes ?? 0) > 0;
}

async function findImageFromSource(sourceUrl: string): Promise<string | null> {
  const source = safeUrl(sourceUrl);
  if (!source) return null;

  const response = await fetch(source.toString(), {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "ParkingLotNavigatorBot/1.0 (+https://parkingnav.app)",
    },
  });
  if (!response.ok) return null;

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.startsWith("image/")) return source.toString();
  if (!contentType.includes("html") && !contentType.includes("xml")) {
    return null;
  }

  const html = await readLimitedText(response, HTML_PREVIEW_BYTES);
  for (const candidate of extractCandidateImages(html)) {
    const image = safeUrl(candidate, source);
    if (image && isUsableImageUrl(image)) return image.toString();
  }
  return null;
}

async function readLimitedText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const remaining = maxBytes - received;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(chunk);
      received += chunk.byteLength;
      if (received >= maxBytes) {
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

function extractCandidateImages(html: string): string[] {
  const candidates: string[] = [];
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    const key = attr(tag, "property") ?? attr(tag, "name") ?? attr(tag, "itemprop");
    if (!key) continue;
    const normalized = key.toLowerCase();
    if (
      normalized === "og:image" ||
      normalized === "og:image:secure_url" ||
      normalized === "twitter:image" ||
      normalized === "image"
    ) {
      const content = attr(tag, "content");
      if (content) candidates.push(decodeHtmlEntities(content));
    }
  }

  const jsonLdImages = html.matchAll(
    /"image"\s*:\s*(?:"([^"]+)"|\[\s*"([^"]+)")/gi,
  );
  for (const match of jsonLdImages) {
    const value = match[1] ?? match[2];
    if (value) candidates.push(decodeHtmlEntities(value));
  }

  return [...new Set(candidates)];
}

function attr(tag: string, name: string): string | null {
  const pattern = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i");
  return pattern.exec(tag)?.[1] ?? null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function safeUrl(value: string, base?: URL): URL | null {
  try {
    const url = base ? new URL(value, base) : new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

function isUsableImageUrl(url: URL): boolean {
  const path = url.pathname.toLowerCase();
  if (path.includes("favicon") || path.includes("logo")) return false;
  if (path.endsWith(".svg")) return false;
  return true;
}

async function logImageSkip(
  db: D1Database,
  target: ImageTargetRow,
  reason: string,
): Promise<void> {
  await logAgentActivity(db, {
    agentId: "pixel",
    action: "image_skip",
    targetKind: target.target_kind,
    targetId: target.id,
    targetTitle: target.title,
    reason,
  });
}

function pixelEnabled(env: ImageEnrichmentEnv): boolean {
  const flag = (env.AGENT_PIXEL_ENABLED ?? "true").toLowerCase();
  return flag !== "false" && flag !== "0";
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(Math.trunc(value), max));
}
