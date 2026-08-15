import { TourApiDetailClient } from "../../backend/src/features/discover/festivals/tourApiDetailClient.js";
import { fetchWithTimeout } from "../../backend/src/features/discover/events/eventProviderUtils.js";
import { mapWithConcurrency } from "./concurrency.js";

// 목록 API는 대표 사진 한 장(TourAPI firstimage, KOPIS poster)만 준다. 갤러리
// 전체는 항목별 detail 호출로만 얻을 수 있어 sync 중에 전부 부를 수 없다.
// 요금 backfill과 같은 방식으로, 아직 조회하지 않은 행을 조금씩 훑어 채운다.
// 한 번 조회한 행은 images_checked_at으로 표시해 사진이 없는 행에 예산이
// 반복 소모되지 않게 한다.

// invocation당 subrequest 예산이 50이라 한 번에 이보다 많이 돌 수 없다.
const DEFAULT_MAX_ITEMS = 30;
// tourApiDetailClient의 DETAIL_ENRICH_CONCURRENCY와 같은 이유(동시 fetch 상한).
const BACKFILL_CONCURRENCY = 5;
// 갤러리가 수십 장인 항목도 있어 상한을 둔다. 앱 상세 화면은 페이징이라
// 이보다 많으면 사실상 아무도 끝까지 넘기지 않는다.
const MAX_IMAGES_PER_ITEM = 12;

type ImageSourceKind = "kopis" | "tourapi";

const IMAGE_SOURCE_KINDS: Record<string, ImageSourceKind> = {
  kopis: "kopis",
  tourapi: "tourapi",
  "area-based-tour": "tourapi",
  "keyword-tour": "tourapi",
};

interface BackfillRow {
  id: string;
  source: string;
  source_item_id: string;
  image_url: string | null;
  images_json: string | null;
}

export interface ImageBackfillResult {
  scanned: number;
  filled: number;
  empty: number;
  failed: number;
  addedImages: number;
  bySource: Record<string, { scanned: number; filled: number }>;
  // 실패가 몰릴 때 원인을 로그 없이 응답만으로 가릴 수 있게 남기는 표본.
  errors?: string[];
}

export interface ImageBackfillEnv {
  KOPIS_API_KEY?: string;
  KOPIS_BASE_URL?: string;
  PUBLIC_DATA_SERVICE_KEY?: string;
  PUBLIC_DATA_BASE_URL?: string;
  IMAGE_BACKFILL_MAX_ITEMS?: string;
}

export async function runImageBackfill(
  db: D1Database,
  env: ImageBackfillEnv,
  options: { maxItems?: number; now?: Date } = {},
): Promise<ImageBackfillResult> {
  const maxItems = options.maxItems ?? maxItemsFromEnv(env);
  const sources = Object.keys(IMAGE_SOURCE_KINDS).filter((source) =>
    hasCredential(env, IMAGE_SOURCE_KINDS[source]),
  );
  const result: ImageBackfillResult = {
    scanned: 0,
    filled: 0,
    empty: 0,
    failed: 0,
    addedImages: 0,
    bySource: {},
  };
  if (sources.length === 0 || maxItems <= 0) return result;

  const now = options.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const placeholders = sources.map(() => "?").join(",");
  // 이미 끝난 행은 앱에 노출되지 않으니 예산을 쓰지 않는다.
  const rows = await db
    .prepare(
      `SELECT id, source, source_item_id, image_url, images_json
         FROM discovery_items
        WHERE source IN (${placeholders})
          AND images_checked_at IS NULL
          AND (end_date IS NULL OR end_date >= ?)
        ORDER BY start_date
        LIMIT ?`,
    )
    .bind(...sources, today, maxItems)
    .all<BackfillRow>();

  const targets = rows.results ?? [];
  if (targets.length === 0) return result;

  const tourClient =
    env.PUBLIC_DATA_SERVICE_KEY && env.PUBLIC_DATA_BASE_URL
      ? new TourApiDetailClient(
          env.PUBLIC_DATA_SERVICE_KEY,
          env.PUBLIC_DATA_BASE_URL,
        )
      : null;

  const checkedAt = now.toISOString();
  const statements: D1PreparedStatement[] = [];

  const fetched = await mapWithConcurrency(
    targets,
    BACKFILL_CONCURRENCY,
    async (row) => {
      try {
        const kind = IMAGE_SOURCE_KINDS[row.source];
        const urls =
          kind === "kopis"
            ? await fetchKopisImages(env, row.source_item_id)
            : tourClient
              ? await tourClient.galleryImages(contentIdOf(row.source_item_id))
              : [];
        return { row, urls, failed: false, message: undefined };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // 429/5xx는 일시적이라 다음 회차에 재시도하고, 그 밖의 오류는 이 id로는
        // 계속 실패하므로 "사진 없음"으로 확정해 예산을 갉아먹지 않게 한다.
        if (isRetryable(message)) {
          console.warn(`image backfill failed id=${row.id}: ${message}`);
          return { row, urls: [], failed: true, message };
        }
        return { row, urls: [], failed: false, message };
      }
    },
  );

  const errorSamples = new Set<string>();
  for (const { row, urls, failed, message } of fetched) {
    result.scanned += 1;
    const bucket = (result.bySource[row.source] ??= { scanned: 0, filled: 0 });
    bucket.scanned += 1;
    if (failed) {
      // 실패한 행은 images_checked_at을 남기지 않아 다음 회차에 다시 시도한다.
      result.failed += 1;
      if (message && errorSamples.size < 5) errorSamples.add(message);
      continue;
    }
    const existing = mergeImages(parseImages(row.images_json), row.image_url);
    const merged = mergeImages(existing, ...urls).slice(0, MAX_IMAGES_PER_ITEM);
    if (merged.length <= existing.length) {
      result.empty += 1;
      statements.push(
        db
          .prepare(
            "UPDATE discovery_items SET images_checked_at = ? WHERE id = ?",
          )
          .bind(checkedAt, row.id),
      );
      continue;
    }
    result.filled += 1;
    result.addedImages += merged.length - existing.length;
    bucket.filled += 1;
    statements.push(
      db
        .prepare(
          `UPDATE discovery_items
              SET images_json = ?,
                  image_url = COALESCE(NULLIF(image_url, ''), ?),
                  images_checked_at = ?
            WHERE id = ?`,
        )
        .bind(JSON.stringify(merged), merged[0], checkedAt, row.id),
    );
  }

  for (let start = 0; start < statements.length; start += 50) {
    await db.batch(statements.slice(start, start + 50));
  }
  if (errorSamples.size > 0) result.errors = [...errorSamples];
  return result;
}

async function fetchKopisImages(
  env: ImageBackfillEnv,
  sourceItemId: string,
): Promise<string[]> {
  const serviceKey = env.KOPIS_API_KEY?.trim();
  const baseUrl = env.KOPIS_BASE_URL;
  if (!serviceKey || !baseUrl) return [];
  const id = sourceItemId.replace(/^kopis:/, "").trim();
  if (!id) return [];
  const url = new URL(`/openApi/restful/pblprfr/${id}`, baseUrl);
  url.searchParams.set("service", serviceKey);
  const response = await fetchWithTimeout(url, {
    headers: { Accept: "application/xml,text/xml,*/*" },
  });
  if (!response.ok) {
    if (response.status === 429 || response.status >= 500) {
      throw new Error(`KOPIS detail API failed: ${response.status}`);
    }
    return [];
  }
  const xml = await response.text();
  // styurl은 <styurls> 안에서 여러 번 반복되는데, parseXmlObject는 같은 태그를
  // 덮어써 한 장만 남긴다. 원본 XML에서 직접 모은다.
  const poster = /<poster>([\s\S]*?)<\/poster>/i.exec(xml)?.[1];
  const styurls = [...xml.matchAll(/<styurl>([\s\S]*?)<\/styurl>/gi)].map(
    (match) => match[1],
  );
  return mergeImages([], poster, ...styurls);
}

// 이미지 URL을 순서대로 합치며 중복을 제거한다. TourAPI는 같은 사진을
// `..._image2_1.jpg`(원본)과 `..._image3_1.jpg`(썸네일)로 두 번 주므로,
// 크기 접미사를 뗀 키로 비교해 같은 사진이 두 장으로 보이지 않게 한다.
function mergeImages(
  base: string[],
  ...candidates: Array<string | null | undefined>
): string[] {
  const merged = [...base];
  const seen = new Set(merged.map(photoKey));
  for (const candidate of candidates) {
    const url = cleanUrl(candidate);
    if (!url) continue;
    const key = photoKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(url);
  }
  return merged;
}

function photoKey(url: string): string {
  return url.replace(/_image\d+_1(\.[A-Za-z0-9]+)$/, "$1");
}

function cleanUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .trim();
  return /^https?:\/\/\S+$/i.test(text) ? text : null;
}

function parseImages(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function isRetryable(message: string): boolean {
  if (message.includes("Too many subrequests")) return true;
  const status = /failed: (\d{3})\b/.exec(message)?.[1];
  if (status) return status === "429" || Number(status) >= 500;
  // resultCode 오류(NODATA 등)는 같은 id로 다시 불러도 결과가 같다.
  if (message.includes("detail failed:")) return false;
  // 타임아웃·네트워크 오류처럼 상태코드가 없는 실패는 일시적으로 본다.
  return true;
}

// discovery_items.source_item_id는 "tourapi:1100492" 형태로 저장된다.
function contentIdOf(sourceItemId: string): string {
  const separator = sourceItemId.lastIndexOf(":");
  return separator >= 0 ? sourceItemId.slice(separator + 1) : sourceItemId;
}

function hasCredential(env: ImageBackfillEnv, kind: ImageSourceKind): boolean {
  return kind === "kopis"
    ? Boolean(env.KOPIS_API_KEY && env.KOPIS_BASE_URL)
    : Boolean(env.PUBLIC_DATA_SERVICE_KEY && env.PUBLIC_DATA_BASE_URL);
}

function maxItemsFromEnv(env: ImageBackfillEnv): number {
  const parsed = Number.parseInt(env.IMAGE_BACKFILL_MAX_ITEMS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_ITEMS;
}
