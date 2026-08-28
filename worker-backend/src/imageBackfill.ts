import { TourApiDetailClient } from "../../backend/src/features/discover/festivals/tourApiDetailClient.js";
import { fetchWithTimeout } from "../../backend/src/features/discover/events/eventProviderUtils.js";
import { mapWithConcurrency } from "./concurrency.js";
import { isRetryableBackfillError } from "./backfillRetry.js";
import { toHttpsImageUrl } from "./imageUrl.js";

// 목록 API는 대표 사진 한 장(TourAPI firstimage, KOPIS poster)만 준다. 갤러리
// 전체는 항목별 detail 호출로만 얻을 수 있어 sync 중에 전부 부를 수 없다.
// 요금 backfill과 같은 방식으로, 아직 조회하지 않은 행을 조금씩 훑어 채운다.
// 한 번 조회한 행은 images_checked_at으로 표시해 사진이 없는 행에 예산이
// 반복 소모되지 않게 한다.

// invocation당 subrequest 예산이 50이라 한 번에 이보다 많이 돌 수 없다.
const DEFAULT_MAX_ITEMS = 30;
// tourApiDetailClient의 DETAIL_ENRICH_CONCURRENCY와 같은 이유(동시 fetch 상한).
const BACKFILL_CONCURRENCY = 5;
// invocation당 CPU 10ms를 넘기면 isolate가 예외 없이 죽는다. 회차 전체를 다 받아온
// 뒤 마지막에 한 번만 batch하면 그때까지 쓴 외부 호출이 통째로 날아간다 — 실측
// 2026-08-18 기준 하루 24회 중 3회만 살아남아 90건/일에 그쳤다. 지오코딩 backfill과
// 같은 방식으로 이만큼 처리할 때마다 나눠 쓴다.
const IMAGE_FLUSH_SIZE = 5;
// 갤러리가 수십 장인 항목도 있어 상한을 둔다. 앱 상세 화면은 페이징이라
// 이보다 많으면 사실상 아무도 끝까지 넘기지 않는다.
const MAX_IMAGES_PER_ITEM = 12;
// TourAPI 갤러리는 행사가 임박해야 채워지는 경우가 많다. 아직 시작 전이고 사진이
// 한 장뿐인 행은 이 기간이 지나면 한 번 더 조회해, 나중에 올라온 사진을 받는다.
const RECHECK_AFTER_DAYS = 30;

type ImageSourceKind = "kopis" | "tourapi";

export const IMAGE_SOURCE_KINDS: Record<string, ImageSourceKind> = {
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
  // 재시도해도 같은 결과인 오류로 확정한 행. empty(사진이 원래 없는 행)와 섞으면
  // 쿼터 장애가 정상 회차처럼 보인다.
  permanentFailures: number;
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
    permanentFailures: 0,
    addedImages: 0,
    bySource: {},
  };
  if (sources.length === 0 || maxItems <= 0) return result;

  const now = options.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const recheckBefore = new Date(
    now.getTime() - RECHECK_AFTER_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const placeholders = sources.map(() => "?").join(",");
  // 예전에는 "처음 조회"와 "재조회"를 OR 하나로 묶어 한 번에 뽑았다. OR 안에
  // json_valid()/json_array_length()가 섞여 있어 B-tree가 후보를 좁히기 전에
  // JSON을 평가해야 했고, EXPLAIN도 MULTI-INDEX OR + 임시 B-tree로 풀렸다.
  // 지금은 두 큐로 나눈다: 아직 조회하지 않은 행을 먼저 채우고, 예산이 남을
  // 때만 재조회 큐를 본다. 재조회 쿼리에서도 (source, images_checked_at)
  // 인덱스가 먼저 범위를 좁힌 뒤에야 JSON 조건이 평가된다. 두 큐는
  // images_checked_at IS NULL / IS NOT NULL로 갈려 겹치는 행이 없다.
  const firstCheck = await db
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

  const targets: BackfillRow[] = [...(firstCheck.results ?? [])];
  const remaining = maxItems - targets.length;
  if (remaining > 0) {
    const recheck = await db
      .prepare(
        `SELECT id, source, source_item_id, image_url, images_json
           FROM discovery_items
          WHERE source IN (${placeholders})
            AND images_checked_at < ?
            AND start_date >= ?
            AND (end_date IS NULL OR end_date >= ?)
            AND (
              images_json IS NULL
              OR NOT json_valid(images_json)
              OR json_array_length(images_json) < 2
            )
          ORDER BY start_date
          LIMIT ?`,
      )
      .bind(...sources, recheckBefore, today, today, remaining)
      .all<BackfillRow>();
    targets.push(...(recheck.results ?? []));
  }

  if (targets.length === 0) return result;

  const tourClient =
    env.PUBLIC_DATA_SERVICE_KEY && env.PUBLIC_DATA_BASE_URL
      ? new TourApiDetailClient(
          env.PUBLIC_DATA_SERVICE_KEY,
          env.PUBLIC_DATA_BASE_URL,
        )
      : null;

  const checkedAt = now.toISOString();
  const errorSamples = new Set<string>();

  for (let start = 0; start < targets.length; start += IMAGE_FLUSH_SIZE) {
    const chunk = targets.slice(start, start + IMAGE_FLUSH_SIZE);
    const statements: D1PreparedStatement[] = [];
    const fetched = await mapWithConcurrency(
      chunk,
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
          // 일시적 실패는 다음 회차에 재시도하고, 같은 id로는 계속 실패하는 오류만
          // 확정해 예산을 갉아먹지 않게 한다.
          const retryable = isRetryableBackfillError(message);
          console.warn(
            `image backfill ${retryable ? "failed" : "gave up"} id=${row.id}: ${message}`,
          );
          return { row, urls: [], failed: retryable, message };
        }
      },
    );

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
      if (message) {
        // 영구 실패로 확정한 행. 사진이 원래 없는 행(empty)과 따로 센다.
        result.permanentFailures += 1;
        if (errorSamples.size < 5) errorSamples.add(message);
        statements.push(markChecked(db, checkedAt, row.id));
        continue;
      }
      const existing = mergeImages(parseImages(row.images_json), row.image_url);
      const merged = mergeImages(existing, ...urls).slice(0, MAX_IMAGES_PER_ITEM);
      if (merged.length <= existing.length) {
        result.empty += 1;
        statements.push(markChecked(db, checkedAt, row.id));
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

    if (statements.length > 0) await db.batch(statements);
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

function markChecked(
  db: D1Database,
  checkedAt: string,
  id: string,
): D1PreparedStatement {
  return db
    .prepare("UPDATE discovery_items SET images_checked_at = ? WHERE id = ?")
    .bind(checkedAt, id);
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
  return /^https?:\/\/\S+$/i.test(text) ? toHttpsImageUrl(text) : null;
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
