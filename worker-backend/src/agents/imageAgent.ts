import { logAgentActivity } from "./headAgent.js";
import { toHttpsImageUrl } from "../imageUrl.js";

type ImageTargetKind = "local_event" | "discovery_item";

type ImageTargetRow = {
  target_kind: ImageTargetKind;
  id: string;
  title: string;
  source_url: string | null;
  image_url: string | null;
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
// 여러 행이 같은 URL을 쓰면 그 행사 사진이 아니라 사이트 공통 배너·로고다
// (AKEI 전시 목록 배너 228건, 충북 관광 og 로고 28건). 사진이 있는 것처럼 보이지만
// 앱에서는 전부 같은 그림이라, 이런 행도 사진 없는 행으로 보고 원문에서 다시 찾는다.
const SHARED_IMAGE_MIN_ROWS = 10;
// og:image 하나만 보던 시절의 skip 기록. 국내 축제·박람회 사이트 대부분이 og 태그를
// 두지 않아 900건이 전부 "찾지 못함"으로 닫혔다. 본문 <img> 후보까지 보게 바꾼 뒤
// 한 번은 다시 시도해야 하므로, 스킵 사유에 이 표식을 남기고 표식이 있는 행만
// 영구 제외한다. 추출기를 다시 손보면 표식을 올린다.
const SKIP_MARK = "[v2]";
// 본문 <img>는 로고·아이콘도 같이 걸린다. 상위 후보 하나만 HEAD로 확인해
// 실제 이미지인지, 로고라기엔 충분히 큰지 본다(회차당 subrequest 예산 때문에 1건).
const MIN_IMAGE_BYTES = 15_000;
// 후보 확인 1건은 HEAD 1건이다. 배치 12건 × 2건 + 원문 24건이면 invocation당
// 외부 fetch 50건 한도 안에 머문다(같은 invocation의 head 에이전트 몫 포함).
const MAX_IMAGE_PROBES = 2;

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
    // 로컬 이벤트(네이버 블로그)는 성공률이 2%대(19/829)인데 배치를 통째로 먹어
    // 성공률 75%(311/413)인 축제·박람회 행이 한 번도 차례를 못 받고 있었다.
    // 축제 쪽에 배치 2/3를 먼저 주고, 남는 자리만 로컬 이벤트가 쓴다.
    const discoveryLimit = Math.max(1, Math.ceil((limit * 2) / 3));
    const discoveryItems = await queryDiscoveryItemTargets(db, discoveryLimit);
    const remaining = Math.max(0, limit - discoveryItems.length);
    const localEvents =
      remaining > 0 ? await queryLocalEventTargets(db, remaining) : [];
    targets = [...discoveryItems, ...localEvents];
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    result.errors.push(`pixel_query:${message.slice(0, 160)}`);
    return result;
  }

  result.considered = targets.length;
  for (const target of targets) {
    if (!target.source_url) {
      result.skipped += 1;
      await logImageSkip(db, target, `원문 URL 없음 ${SKIP_MARK}`);
      continue;
    }

    let imageUrl: string | null = null;
    try {
      imageUrl = toHttpsImageUrl(await findImageFromSource(target.source_url));
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

    if (!imageUrl || imageUrl === target.image_url) {
      result.skipped += 1;
      await logImageSkip(db, target, `원문 대표 이미지를 찾지 못함 ${SKIP_MARK}`);
      continue;
    }

    if (await isSharedPlaceholderImage(db, imageUrl)) {
      result.skipped += 1;
      await logImageSkip(db, target, `사이트 공통 이미지라 사용하지 않음 ${SKIP_MARK}`);
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
      `SELECT 'local_event' AS target_kind, id, title, source_url, image_url
         FROM local_events le
        WHERE le.status IN ('approved', 'pending')
          AND (le.image_url IS NULL OR trim(le.image_url) = '')
          AND le.source_url IS NOT NULL
          AND le.source_url LIKE 'http%'
          AND NOT EXISTS (
            SELECT 1 FROM agent_activity aa
             WHERE aa.target_id = le.id
               AND aa.agent_id = 'pixel'
               AND (
                 aa.action = 'image_enrich'
                 OR (aa.action = 'image_skip' AND aa.reason LIKE ?)
               )
          )
        ORDER BY le.updated_at DESC
        LIMIT ?`,
    )
    .bind(`%${SKIP_MARK}%`, limit)
    .all<ImageTargetRow>();
  return rows.results ?? [];
}

async function queryDiscoveryItemTargets(
  db: D1Database,
  limit: number,
): Promise<ImageTargetRow[]> {
  const rows = await db
    .prepare(
      `SELECT 'discovery_item' AS target_kind, id, title, source_url, image_url
         FROM discovery_items di
        WHERE (
            di.image_url IS NULL
            OR trim(di.image_url) = ''
            OR di.image_url IN (
              SELECT image_url
                FROM discovery_items
               WHERE image_url IS NOT NULL AND trim(image_url) <> ''
               GROUP BY image_url
              HAVING COUNT(*) >= ?
            )
          )
          AND di.source_url IS NOT NULL
          AND di.source_url LIKE 'http%'
          -- AKEI 게시판 상세에는 행사 포스터가 없다(본문 이미지가 no_img.png).
          -- 242건이 배치를 통째로 막아 다른 소스가 차례를 못 받는다.
          AND di.source <> 'akei-trade-expo'
          AND NOT EXISTS (
            SELECT 1 FROM agent_activity aa
             WHERE aa.target_id = di.id
               AND aa.agent_id = 'pixel'
               AND (
                 aa.action = 'image_enrich'
                 OR (aa.action = 'image_skip' AND aa.reason LIKE ?)
               )
          )
        ORDER BY di.last_seen_at DESC
        LIMIT ?`,
    )
    .bind(SHARED_IMAGE_MIN_ROWS, `%${SKIP_MARK}%`, limit)
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
                AND (image_url IS NULL OR trim(image_url) = '' OR image_url = ?)`,
          )
          .bind(imageUrl, now, target.id, target.image_url)
          .run()
      : await db
          .prepare(
            `UPDATE discovery_items
                SET image_url = ?, data_updated_at = ?
              WHERE id = ?
                AND (image_url IS NULL OR trim(image_url) = '' OR image_url = ?)`,
          )
          .bind(imageUrl, now, target.id, target.image_url)
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
  // 국내 축제·박람회 사이트 상당수가 og:image를 두지 않는다. 본문 <img> 중
  // 대표 사진다운 후보를 골라, 실제 사진인지 확인한 것만 쓴다.
  let probes = 0;
  for (const candidate of extractBodyImages(html)) {
    const image = safeUrl(candidate, source);
    if (!image || !isUsableImageUrl(image)) continue;
    if (await looksLikeRealImage(image)) return image.toString();
    probes += 1;
    if (probes >= MAX_IMAGE_PROBES) break;
  }
  return null;
}

// 본문 <img>는 로고·아이콘·버튼과 섞여 있다. 파일명·경로와 크기 속성으로
// 확실한 장식만 걸러내고, 업로드 경로처럼 본문 사진일 가능성이 높은 순으로 낸다.
function extractBodyImages(html: string): string[] {
  const scored: Array<{ url: string; score: number }> = [];
  const seen = new Set<string>();
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const raw =
      attr(tag, "src") ?? attr(tag, "data-src") ?? attr(tag, "data-original");
    if (!raw) continue;
    const url = decodeHtmlEntities(raw);
    if (!url || seen.has(url)) continue;
    const lower = url.toLowerCase();
    if (/(favicon|logo|icon|sprite|blank|spacer|btn_|bul_|ico_|banner|_txt)/.test(lower)) {
      continue;
    }
    // gif는 이 사이트들에서 거의 전부 아이콘·구분선 같은 장식이다.
    if (lower.endsWith(".svg") || /\.gif(\?|$)/.test(lower)) continue;
    if (isTinyImageTag(tag)) continue;
    seen.add(url);
    let score = 0;
    if (/(upload|editor|board|bbs|poster|photo|main|thumb|files?|data)/.test(lower)) {
      score += 2;
    }
    if (/\.(jpe?g|png|webp)(\?|$)/.test(lower)) score += 1;
    scored.push({ url, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((entry) => entry.url);
}

function isTinyImageTag(tag: string): boolean {
  for (const name of ["width", "height"]) {
    const value = Number.parseInt(attr(tag, name) ?? "", 10);
    if (Number.isFinite(value) && value > 0 && value < 200) return true;
  }
  return false;
}

// 로고를 대표 사진으로 박아 넣지 않도록 HEAD로 한 번 확인한다. HEAD를 막는
// 서버(405/501)는 확인할 방법이 없어 통과시킨다.
async function looksLikeRealImage(url: URL): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "HEAD",
      headers: {
        "user-agent": "ParkingLotNavigatorBot/1.0 (+https://parkingnav.app)",
      },
    });
  } catch {
    return false;
  }
  if (response.status === 405 || response.status === 501) return true;
  if (!response.ok) return false;
  if (!(response.headers.get("content-type") ?? "").startsWith("image/")) {
    return false;
  }
  const length = Number.parseInt(
    response.headers.get("content-length") ?? "",
    10,
  );
  return Number.isFinite(length) && length > 0 ? length >= MIN_IMAGE_BYTES : true;
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
  // AKEI 게시판 og:image가 전시 목록 배너 하나였던 것처럼, 사이트 공통 이미지가
  // og:image로 걸려 있는 곳이 많다. 행사 사진이 아니라 사이트 간판이므로 거른다.
  if (
    path.includes("banner") ||
    path.includes("og_image") ||
    path.includes("/common/") ||
    path.includes("no_img")
  ) {
    return false;
  }
  if (path.endsWith(".svg")) return false;
  return true;
}

// 경로 패턴으로 못 거른 공통 이미지는 "여러 행이 같은 URL을 쓴다"로 드러난다.
// D1 쿼리는 subrequest 예산과 무관하므로 적용 직전에 한 번 더 확인한다.
async function isSharedPlaceholderImage(
  db: D1Database,
  imageUrl: string,
): Promise<boolean> {
  const row = await db
    .prepare("SELECT COUNT(*) AS c FROM discovery_items WHERE image_url = ?")
    .bind(imageUrl)
    .first<{ c: number }>();
  return (row?.c ?? 0) >= SHARED_IMAGE_MIN_ROWS;
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
