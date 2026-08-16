import type { EventCategory, Festival, FreeEvent } from "@parking/shared-types";
import { distanceMeters } from "../../backend/src/services/geo.js";
import { REGION_FALLBACK_COORDINATES } from "../../backend/src/features/discover/events/eventProviderUtils.js";
import { mapWithConcurrency } from "./concurrency.js";
import { feeFreeFlag, normalizeFee } from "./feeNormalize.js";
import { TAGGING_VERSION } from "./llmTaggingSchema.js";
import {
  currentDiscoveryChunkIndex,
  DISCOVERY_PROVIDER_CHUNK_COUNT,
  DISCOVERY_PROVIDER_CHUNKS,
  type DiscoverySyncKind,
} from "./discoverySchedule.js";

export { mapWithConcurrency } from "./concurrency.js";
export {
  currentDiscoveryChunkIndex,
  DISCOVERY_PROVIDER_CHUNK_COUNT,
} from "./discoverySchedule.js";

type DiscoveryType = "festival" | "event";

const DISCOVERY_RESULT_LIMIT = 5000;
const DISCOVERY_CLUSTER_RESULT_LIMIT = 5000;
const DISCOVERY_STALE_DAYS: Record<DiscoveryType, number> = {
  festival: 100,
  event: 45,
};
const DISCOVERY_SYNC_RADIUS_METERS = 90000;
const DEFAULT_DISCOVERY_SYNC_CONCURRENCY = 4;
const DEFAULT_DISCOVERY_SYNC_FETCH_TIMEOUT_MS = 8000;

const NATIONAL_DISCOVERY_CENTERS: Array<{
  id: string;
  lat: number;
  lng: number;
}> = [
  { id: "seoul", lat: 37.5665, lng: 126.978 },
  { id: "busan", lat: 35.1796, lng: 129.0756 },
  { id: "daegu", lat: 35.8714, lng: 128.6014 },
  { id: "incheon", lat: 37.4563, lng: 126.7052 },
  { id: "gwangju", lat: 35.1595, lng: 126.8526 },
  { id: "daejeon", lat: 36.3504, lng: 127.3845 },
  { id: "ulsan", lat: 35.5384, lng: 129.3114 },
  { id: "sejong", lat: 36.48, lng: 127.289 },
  { id: "suwon", lat: 37.2636, lng: 127.0286 },
  { id: "chuncheon", lat: 37.8813, lng: 127.7298 },
  { id: "cheongju", lat: 36.6424, lng: 127.489 },
  { id: "jeonju", lat: 35.8242, lng: 127.148 },
  { id: "mokpo", lat: 34.8118, lng: 126.3922 },
  { id: "andong", lat: 36.5684, lng: 128.7294 },
  { id: "changwon", lat: 35.2279, lng: 128.6811 },
  { id: "gangneung", lat: 37.7519, lng: 128.8761 },
  { id: "jeju", lat: 33.4996, lng: 126.5312 },
];

const SEOUL_DISCOVERY_CENTER = { id: "seoul", lat: 37.5665, lng: 126.978 };

export interface DiscoveryQueryOptions {
  radiusMeters: number;
  upcomingWithinDays: number;
  pastWithinDays?: number;
  ongoingOnly?: boolean;
  freeOnly?: boolean;
}

export interface DiscoveryCluster {
  id: string;
  type: DiscoveryType;
  lat: number;
  lng: number;
  count: number;
}

export interface DiscoverySyncRuntime {
  festivalService: { nearby(query: SyncDiscoverQuery): Promise<Festival[]> };
  eventService: { nearby(query: SyncDiscoverQuery): Promise<FreeEvent[]> };
}

export interface DiscoverySyncResult {
  syncType: string;
  fetched: number;
  upserted: number;
  skipped: number;
  pruned: number;
  sources: Record<string, number>;
  // 타임아웃된 center는 빈 배열을 돌려주므로 결과만 봐서는 성공과 구분되지 않는다.
  // 어느 center가 시간 안에 못 끝냈는지 sync_runs에 남기려고 함께 올린다.
  timedOutCenters: string[];
  generatedAt: string;
}

interface SyncDiscoverQuery {
  lat: number;
  lng: number;
  radiusMeters: number;
  upcomingWithinDays: number;
  ongoingOnly?: boolean;
  freeOnly?: boolean;
  providerAllowlist?: ReadonlySet<string>;
  signal?: AbortSignal;
}

interface DiscoveryItemRow {
  id: string;
  type: DiscoveryType;
  source: string;
  source_item_id: string;
  title: string;
  subtitle: string | null;
  category_text: string | null;
  start_date: string | null;
  end_date: string | null;
  status: "ongoing" | "upcoming" | null;
  is_free: number | null;
  venue_name: string | null;
  address: string;
  lat: number;
  lng: number;
  rating: number | null;
  review_count: number | null;
  lowest_price_text: string | null;
  lowest_price_platform: string | null;
  source_url: string | null;
  image_url: string | null;
  images_json: string | null;
  tags_json: string | null;
  amenities_json: string | null;
  offers_json: string | null;
  raw_payload: string | null;
  data_updated_at: string | null;
  primary_category: string | null;
  category_tags_json: string | null;
}

type DiscoveryItem = Festival | FreeEvent;

interface DiscoveryRowPayload {
  id: string;
  type: "festival";
  source: string;
  sourceItemId: string;
  title: string;
  subtitle: string | null;
  categoryText: string | null;
  startDate: string | null;
  endDate: string | null;
  status: "ongoing" | "upcoming" | null;
  isFree: number | null;
  venueName: string | null;
  address: string;
  lat: number;
  lng: number;
  rating: number | null;
  reviewCount: number | null;
  lowestPriceText: string | null;
  lowestPricePlatform: string | null;
  sourceUrl: string | null;
  imageUrl: string | null;
  imagesJson: string | null;
  tagsJson: string | null;
  amenitiesJson: string | null;
  offersJson: string | null;
  rawPayload: string;
  dataUpdatedAt: string;
  primaryCategory: string | null;
  taggingVersion: number;
}

export async function queryFestivalsFromCache(
  db: D1Database,
  lat: number,
  lng: number,
  options: DiscoveryQueryOptions,
): Promise<Festival[]> {
  const rows = await queryDiscoveryRows(db, "festival", lat, lng, options);
  return dedupeFestivals(rows.map((row) => mapFestivalRow(row, lat, lng)));
}

// 같은 축제가 여러 provider/동기화로 중복 저장되는 경우가 있어 응답 단계에서 제거한다.
// 좌표가 실제로 가깝고(provider마다 지오코딩이 수백m씩 어긋나는 경우가 있어 격자
// 반올림 대신 실거리로 판단) 날짜 범위가 겹치는 항목끼리만 하나의 중복 후보로 보고,
// 그 안에서 제목이 (공백 차이를 무시하고) 완전히 같거나 단어 구성이 완전히 같으면
// (어순만 다른 경우, 예: "봄꽃축제 제1회" vs "제1회 봄꽃축제") 같은 축제로 묶어
// 설명·부제·이미지가 더 풍부한 항목을 남긴다. 날짜까지 요구하는 이유: 같은 제목·같은
// 장소(투어 공연 등)라도 회차가 다르면 서로 다른 항목이므로, 좌표만으로 묶으면 서로
// 다른 공연 회차가 하나로 합쳐지는 오탐이 생긴다. 단어 구성 비교는 정확히 같은
// 단어 집합일 때만 통과시키고, 유사도 점수 같은 fuzzy 매칭은 쓰지 않는다 — 짧은
// 한국어 제목은 "축제"/"페스티벌" 같은 공통 단어와 지명 비중이 커서, 문자 단위
// 유사도는 "가을 축제"↔"가을꽃 축제", "제1회 전통시장 축제"↔"제2회 전통시장 축제"처럼
// 실제로는 다른 축제를 임계값 이상으로 잘못 판정하는 사례가 있었다(정보 오표기 위험).
const FESTIVAL_DEDUPE_MAX_DISTANCE_METERS = 1500;

// 좌표를 공연장·전시장 자체에서 받아오는 소스. 여기서는 같은 제목·같은 기간이라도
// 장소가 다르면 서로 다른 공연/전시이므로 위 1500m 기준을 그대로 쓴다.
const PRECISE_COORDINATE_SOURCES = new Set(["kopis", "akei-trade-expo"]);

// 나머지 축제 소스는 좌표를 주소 지오코딩이나 지역 대표 좌표로 채운다. 실제로 같은
// 축제인데 provider마다 몇 km씩 어긋난 사례가 확인됐다 — "송도해변축제"는 행사장
// 주소(달빛공원)와 시 게시판이 적은 인근 주소가 1.9km, "평택호 물빛축제"는 18.8km
// 차이가 나 1500m 기준으로는 갈라져 앱에 중복 노출됐다. 제목 핵심부가 완전히 같고
// 회차·연도가 충돌하지 않으며 기간이 겹치는 경우에만 적용되는 완화이므로, 넓혀도
// 서로 다른 축제가 합쳐질 위험은 낮다. 전국 단위로 같은 이름을 여러 지역에서 동시에
// 여는 프로그램(예: 12개 지역 "국가유산 미디어아트", 30km 이상 떨어짐)은 이 상한 밖에
// 남는다.
const FESTIVAL_DEDUPE_COARSE_MAX_DISTANCE_METERS = 20000;

// clusterFilter가 주어지면, 카테고리 등으로 후보를 미리 좁힌 다음 dedup하는 대신
// 그룹(중복 묶음) 단위로 조건을 확인한다. 그래야 같은 실제 축제가 provider별로 다른
// category 태그를 갖고 있어도 항상 같은 승자를 고르며(=/api/festivals와 /api/performances가
// 같은 id를 돌려줌), 조건에 맞는 멤버가 하나라도 있으면 그룹 전체에서 가장 풍부한 항목을 남긴다.
export function dedupeFestivals(
  festivals: Festival[],
  clusterFilter?: (cluster: Festival[]) => boolean,
): Festival[] {
  const clusters: Festival[][] = [];
  // 제목 키가 같은 묶음만 후보로 본다. 전체 묶음을 훑는 방식(O(n²))은 좌표 미상 항목이
  // 지역 대표 좌표(예: 서울 37.5665/126.978)에 천 건 넘게 쌓인 뒤로 Worker CPU 한도를
  // 넘겨 /api/festivals·/api/performances가 503(error code 1102)으로 죽었다.
  const clustersByTitleKey = new Map<string, number[]>();
  const clustersByWordKey = new Map<string, number[]>();
  const register = (map: Map<string, number[]>, key: string, index: number) => {
    const bucket = map.get(key);
    if (bucket) bucket.push(index);
    else map.set(key, [index]);
  };

  for (const festival of festivals) {
    const titleKey = festivalDedupeKey(festival);
    const wordKey = wordOrderInvariantKey(festival.title);
    // 두 키 중 하나만 같아도 후보이므로 합집합을 만들고, 원래 동작대로 먼저 만들어진
    // 묶음이 이기도록 인덱스 오름차순으로 확인한다.
    const candidates = [
      ...new Set([
        ...(clustersByTitleKey.get(titleKey) ?? []),
        ...(clustersByWordKey.get(wordKey) ?? []),
      ]),
    ].sort((a, b) => a - b);
    const matched = candidates.find((index) =>
      isSameFestivalOccurrence(clusters[index][0], festival),
    );
    if (matched !== undefined) {
      clusters[matched].push(festival);
      continue;
    }
    const index = clusters.length;
    clusters.push([festival]);
    register(clustersByTitleKey, titleKey, index);
    register(clustersByWordKey, wordKey, index);
  }

  const result: Festival[] = [];
  for (const cluster of clusters) {
    if (clusterFilter && !clusterFilter(cluster)) continue;
    result.push(mergeFestivalCluster(cluster));
  }
  return result;
}

// 같은 축제라도 provider마다 채우는 필드가 다르다(한쪽은 설명만, 다른 쪽은 이미지·요금만).
// 가장 정보가 많은 항목을 기준으로 삼고 비어 있는 필드만 다른 항목에서 채운다.
// id·좌표·기간·source는 기준 항목 것을 유지한다 — 지도 핀과 상세 조회가 한 출처를 가리켜야 하고,
// 기간을 합치면 provider 한 곳의 잘못된 날짜가 노출 기간을 부풀린다.
const MERGEABLE_TEXT_FIELDS: readonly (keyof Festival)[] = [
  "subtitle",
  "description",
  "venueName",
  "address",
  "sourceUrl",
  "imageUrl",
  "admissionFee",
  "discountInfo",
  "bookingInfo",
  "contactPhone",
  "ageLimit",
  "programInfo",
  "organizerName",
];
const MERGEABLE_LIST_FIELDS: readonly (keyof Festival)[] = [
  "imageUrls",
  "tags",
  "categoryTags",
];

function mergeFestivalCluster(cluster: Festival[]): Festival {
  const base = cluster.reduce((best, f) =>
    festivalRichnessScore(f) > festivalRichnessScore(best) ? f : best,
  );
  if (cluster.length === 1) return base;

  const merged = { ...base } as unknown as Record<string, unknown>;
  const donors = cluster.filter((f) => f !== base);
  for (const field of MERGEABLE_TEXT_FIELDS) {
    if (hasText(merged[field])) continue;
    const donor = donors.find((f) => hasText(f[field]));
    if (donor) merged[field] = donor[field];
  }
  for (const field of MERGEABLE_LIST_FIELDS) {
    const current = merged[field];
    if (Array.isArray(current) && current.length > 0) continue;
    const donor = donors.find((f) => {
      const value = f[field];
      return Array.isArray(value) && value.length > 0;
    });
    if (donor) merged[field] = donor[field];
  }
  if (merged.primaryCategory == null) {
    const donor = donors.find((f) => f.primaryCategory != null);
    if (donor) merged.primaryCategory = donor.primaryCategory;
  }
  return merged as unknown as Festival;
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

// 제목 키가 이미 같다고 확인된 두 항목이 실제로 같은 회차인지(좌표·기간) 본다.
function isSameFestivalOccurrence(
  representative: Festival,
  festival: Festival,
): boolean {
  const maxDistance =
    PRECISE_COORDINATE_SOURCES.has(representative.source) &&
    PRECISE_COORDINATE_SOURCES.has(festival.source)
      ? FESTIVAL_DEDUPE_MAX_DISTANCE_METERS
      : FESTIVAL_DEDUPE_COARSE_MAX_DISTANCE_METERS;
  if (
    distanceMeters(representative.lat, representative.lng, festival.lat, festival.lng) >
    maxDistance
  ) {
    return false;
  }
  // 회차·연도 수식어는 아래 festivalCoreTitle에서 제목 비교 시 무시하므로, 양쪽 모두
  // 명시한 회차(또는 연도)가 서로 다르면 여기서 다른 회차로 갈라낸다.
  if (conflictingQualifier(festivalEdition(representative.title), festivalEdition(festival.title))) {
    return false;
  }
  if (conflictingQualifier(festivalYear(representative.title), festivalYear(festival.title))) {
    return false;
  }
  return dateRangesOverlap(representative, festival);
}

function conflictingQualifier(a: number | null, b: number | null): boolean {
  return a !== null && b !== null && a !== b;
}

function festivalEdition(title: string): number | null {
  const matched = title.match(/제\s*(\d{1,3})\s*회/) ?? title.match(/^\s*(\d{1,3})\s*회\s/);
  return matched ? Number(matched[1]) : null;
}

// 제목 앞뒤에 붙은 연도만 본다 ("2026 한강페스티벌", "DDP 건축투어 2026").
// 제목 중간의 숫자("문학주간2026")는 이름의 일부라 수식어로 보지 않는다.
function festivalYear(title: string): number | null {
  const matched =
    title.match(/^\s*((?:19|20)\d{2})년?(?=\s|$)/) ??
    title.match(/(?:^|\s)((?:19|20)\d{2})년?\s*$/);
  return matched ? Number(matched[1]) : null;
}

function festivalDedupeKey(festival: Festival): string {
  return normalizeFestivalTitle(festival.title);
}

function normalizeFestivalTitle(title: string): string {
  return festivalCoreTitle(title).replace(/\s+/g, "");
}

// provider마다 같은 축제에 회차·연도·주최기관 접두어를 붙이거나 빼서 보낸다
// (예: "수원화성문화제"/"제63회 수원화성문화제", "DDP 건축투어"/"DDP 건축투어 2026",
// "뮤지컬 베토벤"/"[세종문화회관] 뮤지컬 베토벤"). 이런 수식어만 벗겨낸 핵심 제목이
// 완전히 같을 때만 같은 축제로 본다 — 유사도 점수 기반 fuzzy 매칭은 여전히 쓰지 않는다.
// 회차·연도가 양쪽 다 있고 서로 다른 경우는 isSameFestivalOccurrence에서 걸러낸다.
const TITLE_LEADING_AFFIXES: RegExp[] = [
  /^[[(【〈《『][^\])】〉》』]*[\])】〉》』]\s*/, // 주최기관·시리즈 접두어
  /^(?:국제)?인증전시회\s*/, // AKEI 게시판 라벨
  /^(?:19|20)\d{2}년?\s*/, // 연도
  /^제?\s*\d{1,3}\s*회\s*/, // 회차
];
const TITLE_TRAILING_AFFIXES: RegExp[] = [
  /\s+(?:19|20)\d{2}년?$/, // 연도
  /\s*제?\s*\d{1,3}\s*회$/, // 회차 ("봄꽃축제 제1회")
];

function festivalCoreTitle(title: string): string {
  let text = title.toLowerCase().trim();
  // 접두어가 겹쳐 붙는 경우가 있어("인증전시회 2026 …") 더 벗겨낼 게 없을 때까지 반복한다.
  for (let pass = 0; pass < TITLE_LEADING_AFFIXES.length; pass += 1) {
    const before = text;
    for (const pattern of TITLE_LEADING_AFFIXES) text = text.replace(pattern, "");
    for (const pattern of TITLE_TRAILING_AFFIXES) text = text.replace(pattern, "");
    text = text.trim();
    if (text === before) break;
  }
  // 수식어만으로 이루어진 제목이면 원본을 그대로 쓴다(빈 키로 서로 뭉치는 것 방지).
  return text.length > 0 ? text : title.toLowerCase().trim();
}

// 공백 기준 단어 집합을 정렬해 비교 — 단어 순서만 바뀐 제목을 완전 일치로 인식한다.
// (문자 단위로 쪼개지 않는 이유는 위 상수 설명 참고: 서로 다른 단어가 섞인 제목까지
// 같은 축제로 오판하는 걸 막기 위함.)
function wordOrderInvariantKey(title: string): string {
  return festivalCoreTitle(title)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .sort()
    .join("|");
}

// provider마다 같은 축제의 시작/종료일을 며칠씩 다르게 보고하는 경우가 있어(예: 사전 행사 포함
// 여부) 완전 일치 대신 기간이 실제로 겹치는지로 판단한다.
function dateRangesOverlap(a: Festival, b: Festival): boolean {
  if (!a.startDate || !a.endDate || !b.startDate || !b.endDate) {
    return a.startDate === b.startDate;
  }
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

function festivalRichnessScore(festival: Festival): number {
  let score = 0;
  if (festival.description && festival.description.trim().length > 0) score += 4;
  if (festival.subtitle && festival.subtitle.trim().length > 0) score += 2;
  if ((festival.imageUrls && festival.imageUrls.length > 0) || festival.imageUrl)
    score += 1;
  return score;
}

// KOPIS를 비롯한 public API 이벤트는 discoveryRow에서 type='festival'로 저장하므로
// (discovery_items에 type='event' 행은 존재하지 않는다) 여기서 source로 갈라낸다.
// 예전에는 type='event'를 조회해 events를 만들었는데, 그 조합은 항상 빈 배열이라
// music_performance 태그가 붙지 않은 KOPIS 공연이 응답에서 통째로 빠졌다.
export const PERFORMANCE_EVENT_SOURCES = new Set(["kopis"]);

export async function queryPerformancesFromCache(
  db: D1Database,
  lat: number,
  lng: number,
  options: DiscoveryQueryOptions,
): Promise<{ festivals: Festival[]; events: FreeEvent[] }> {
  const rows = await queryDiscoveryRows(db, "festival", lat, lng, options);
  const events = rows
    .filter((row) => PERFORMANCE_EVENT_SOURCES.has(row.source))
    .map((row) => mapEventRow(row, lat, lng))
    .filter((item) => !options.freeOnly || item.isFree);
  // 같은 항목이 events와 festivals 양쪽에 실리지 않도록 event source는 제외한다.
  const festivals = dedupeFestivals(
    rows
      .filter((row) => !PERFORMANCE_EVENT_SOURCES.has(row.source))
      .map((row) => mapFestivalRow(row, lat, lng)),
    (cluster) => cluster.some((f) => f.primaryCategory === "music_performance"),
  );
  return { festivals, events };
}

export async function queryDiscoveryClusters(
  db: D1Database,
  types: DiscoveryType[],
  lat: number,
  lng: number,
  options: Pick<DiscoveryQueryOptions, "radiusMeters">,
  clusterMeters: number,
): Promise<DiscoveryCluster[]> {
  const rows = (
    await Promise.all(
      types.map((type) =>
        queryDiscoveryRows(
          db,
          type,
          lat,
          lng,
          { ...options, upcomingWithinDays: 365 },
          DISCOVERY_CLUSTER_RESULT_LIMIT,
        ),
      ),
    )
  ).flat();
  const clusters = new Map<
    string,
    { type: DiscoveryType; latSum: number; lngSum: number; count: number }
  >();
  for (const row of rows) {
    const latStep = clusterMeters / 111320;
    const lngStep =
      clusterMeters /
      Math.max(40000, 111320 * Math.cos((row.lat * Math.PI) / 180));
    const key = `${row.type}:${Math.round(row.lat / latStep)}:${Math.round(row.lng / lngStep)}`;
    const cluster = clusters.get(key) ?? {
      type: row.type,
      latSum: 0,
      lngSum: 0,
      count: 0,
    };
    cluster.latSum += row.lat;
    cluster.lngSum += row.lng;
    cluster.count += 1;
    clusters.set(key, cluster);
  }
  return [...clusters.entries()].map(([id, cluster]) => ({
    id,
    type: cluster.type,
    lat: cluster.latSum / cluster.count,
    lng: cluster.lngSum / cluster.count,
    count: cluster.count,
  }));
}

/// center 타임아웃은 빈 배열로 흡수되므로 그대로 두면 전부 'success'로 기록된다.
/// 한 건도 못 가져온 회차는 'timeout'으로 남겨 대시보드 집계에 잡히게 하고,
/// 일부만 실패한 회차는 성공으로 두되 message에 어느 center가 늦었는지 적는다.
function syncRunOutcome(result: DiscoverySyncResult): {
  status: "success" | "timeout";
  message: string | null;
} {
  if (result.timedOutCenters.length === 0) {
    return { status: "success", message: null };
  }
  const message = `timed out ${result.timedOutCenters.length}/${NATIONAL_DISCOVERY_CENTERS.length} centers: ${result.timedOutCenters.join(",")}`;
  return { status: result.fetched > 0 ? "success" : "timeout", message };
}

export async function syncDiscoveryCache(
  db: D1Database,
  runtime: DiscoverySyncRuntime,
  kinds: DiscoverySyncKind[],
): Promise<DiscoverySyncResult[]> {
  const results: DiscoverySyncResult[] = [];
  for (const kind of kinds) {
    const run = await startSyncRun(db, `discover:${kind}`);
    try {
      const result = await syncDiscoveryKind(db, runtime, kind);
      const outcome = syncRunOutcome(result);
      await finishSyncRun(db, run.id, outcome.status, result, outcome.message);
      results.push(result);
    } catch (error) {
      const failed = {
        syncType: `discover:${kind}`,
        fetched: 0,
        upserted: 0,
        skipped: 0,
        pruned: 0,
        sources: {},
        timedOutCenters: [],
        generatedAt: new Date().toISOString(),
      };
      await finishSyncRun(
        db,
        run.id,
        "failed",
        failed,
        error instanceof Error ? error.message : "Unknown error",
      );
      throw error;
    }
  }
  return results;
}

async function syncDiscoveryKind(
  db: D1Database,
  runtime: DiscoverySyncRuntime,
  kind: DiscoverySyncKind,
  providerAllowlist?: ReadonlySet<string>,
  fetchTimeoutMs?: number,
): Promise<DiscoverySyncResult> {
  const generatedAt = new Date().toISOString();
  const centers = centersForKind();
  const batches = await mapWithConcurrency(
    centers,
    discoverySyncConcurrency(),
    async (center) => {
      const query = {
        lat: center.lat,
        lng: center.lng,
        radiusMeters: DISCOVERY_SYNC_RADIUS_METERS,
        upcomingWithinDays: 365,
        providerAllowlist,
      };
      const outcome = await fetchDiscoveryCenterWithTimeout(
        runtime,
        kind,
        center.id,
        query,
        fetchTimeoutMs,
      );
      return { centerId: center.id, ...outcome };
    },
  );
  const timedOutCenters = batches
    .filter((batch) => batch.timedOut)
    .map((batch) => batch.centerId);
  const items = dedupeItems(batches.flatMap((batch) => batch.items));
  const sources = countSources(items);
  const validItems = items.filter(
    (item) => Number.isFinite(item.lat) && Number.isFinite(item.lng),
  );
  const skipped = items.length - validItems.length;
  const upserted = await upsertDiscoveryItems(db, validItems, generatedAt);
  // festivals/events 어느 kind로 들어와도 행은 type='festival'로 저장되므로,
  // 프루닝 대상도 하나뿐이다. (예전 events 가드는 지울 행이 없어 무의미했다.)
  const pruned = await pruneStaleDiscovery(db, "festival");
  return {
    syncType: `discover:${kind}`,
    fetched: items.length,
    upserted,
    skipped,
    pruned,
    sources,
    timedOutCenters,
    generatedAt,
  };
}

export async function syncDiscoveryChunk(
  db: D1Database,
  runtime: DiscoverySyncRuntime,
  chunkIndex: number,
): Promise<DiscoverySyncResult> {
  const normalized =
    ((chunkIndex % DISCOVERY_PROVIDER_CHUNK_COUNT) +
      DISCOVERY_PROVIDER_CHUNK_COUNT) %
    DISCOVERY_PROVIDER_CHUNK_COUNT;
  const chunk = DISCOVERY_PROVIDER_CHUNKS[normalized];
  const providerSet = new Set(chunk.providers);
  const syncType = `discover:${chunk.kind}:${chunk.providers.join("+")}`;
  const run = await startSyncRun(db, syncType);
  try {
    const result = await syncDiscoveryKind(
      db,
      runtime,
      chunk.kind,
      providerSet,
      chunk.fetchTimeoutMs,
    );
    const annotated = { ...result, syncType };
    const outcome = syncRunOutcome(annotated);
    await finishSyncRun(db, run.id, outcome.status, annotated, outcome.message);
    return annotated;
  } catch (error) {
    const failed = {
      syncType,
      fetched: 0,
      upserted: 0,
      skipped: 0,
      pruned: 0,
      sources: {},
      timedOutCenters: [],
      generatedAt: new Date().toISOString(),
    };
    await finishSyncRun(
      db,
      run.id,
      "failed",
      failed,
      error instanceof Error ? error.message : "Unknown error",
    );
    throw error;
  }
}

function centersForKind(): Array<{ id: string; lat: number; lng: number }> {
  return NATIONAL_DISCOVERY_CENTERS;
}

// 좌표를 못 구한 항목은 수집 단계에서 지역 대표 좌표(예: 서울 37.5665/126.978)로 저장된다.
// 실제 위치가 아니므로 지도에서는 한 점에 수천 개가 겹치고 거리 정렬도 의미가 없어진다.
// 지오코딩이 좌표를 채우면 자동으로 다시 노출되도록, 삭제 대신 응답에서만 제외한다.
function isRegionFallbackCoordinate(lat: number, lng: number): boolean {
  return REGION_FALLBACK_COORDINATES.some(
    (coordinate) =>
      Math.abs(coordinate.lat - lat) < 1e-7 && Math.abs(coordinate.lng - lng) < 1e-7,
  );
}

async function queryDiscoveryRows(
  db: D1Database,
  type: DiscoveryType,
  lat: number,
  lng: number,
  options: DiscoveryQueryOptions,
  limit = DISCOVERY_RESULT_LIMIT,
): Promise<DiscoveryItemRow[]> {
  const radiusMeters = options.radiusMeters;
  const latDelta = radiusMeters / 111320;
  const lngDelta =
    radiusMeters / Math.max(40000, 111320 * Math.cos((lat * Math.PI) / 180));
  const minSeenAt = new Date(
    Date.now() - DISCOVERY_STALE_DAYS[type] * 24 * 60 * 60 * 1000,
  ).toISOString();
  // LIMIT만 걸면 SQLite가 bbox 안에서 어떤 행을 돌려줄지 정해지지 않아, bbox 결과가
  // LIMIT을 넘는 순간 가까운 축제가 조용히 빠지고 응답이 매번 달라진다. 근사 거리
  // (경도는 위도에 따른 실거리 차이를 cos²로 보정) 오름차순으로 잘라 항상 가까운 쪽을 남긴다.
  const lngScale = Math.cos((lat * Math.PI) / 180) ** 2;
  const rows = await db
    .prepare(
      `SELECT *
       FROM discovery_items
       WHERE type = ?
         AND lat BETWEEN ? AND ?
         AND lng BETWEEN ? AND ?
         AND last_seen_at >= ?
       ORDER BY (lat - ?) * (lat - ?) + (lng - ?) * (lng - ?) * ?
       LIMIT ?`,
    )
    .bind(
      type,
      lat - latDelta,
      lat + latDelta,
      lng - lngDelta,
      lng + lngDelta,
      minSeenAt,
      lat,
      lat,
      lng,
      lng,
      lngScale,
      Math.max(limit + 500, limit),
    )
    .all<DiscoveryItemRow>();
  return (rows.results ?? [])
    .filter((row) => !isRegionFallbackCoordinate(row.lat, row.lng))
    .filter((row) => distanceMeters(lat, lng, row.lat, row.lng) <= radiusMeters)
    .filter((row) => rowPassesFilters(row, options))
    .sort((a, b) => sortDiscoveryRows(a, b, lat, lng))
    .slice(0, limit);
}

const DISCOVERY_UPSERT_BATCH_SIZE = 50;

const DISCOVERY_UPSERT_SQL = `INSERT INTO discovery_items (
        id, type, source, source_item_id, title, subtitle, category_text,
        start_date, end_date, status, is_free, venue_name, address, lat, lng,
        rating, review_count, lowest_price_text, lowest_price_platform,
        source_url, image_url, images_json, tags_json, amenities_json, offers_json, raw_payload,
        data_updated_at, primary_category, tagging_version, first_seen_at, last_seen_at, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        source = excluded.source,
        source_item_id = excluded.source_item_id,
        title = excluded.title,
        subtitle = excluded.subtitle,
        category_text = excluded.category_text,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        status = excluded.status,
        is_free = excluded.is_free,
        venue_name = excluded.venue_name,
        address = excluded.address,
        lat = excluded.lat,
        lng = excluded.lng,
        rating = excluded.rating,
        review_count = excluded.review_count,
        lowest_price_text = excluded.lowest_price_text,
        lowest_price_platform = excluded.lowest_price_platform,
        source_url = excluded.source_url,
        image_url = COALESCE(NULLIF(excluded.image_url, ''), NULLIF(image_url, '')),
        images_json = CASE
          WHEN COALESCE(CASE WHEN json_valid(images_json) THEN json_array_length(images_json) END, 0)
             > COALESCE(CASE WHEN json_valid(excluded.images_json) THEN json_array_length(excluded.images_json) END, 0)
          THEN images_json
          ELSE COALESCE(NULLIF(excluded.images_json, ''), NULLIF(images_json, ''))
        END,
        tags_json = excluded.tags_json,
        amenities_json = excluded.amenities_json,
        offers_json = excluded.offers_json,
        raw_payload = excluded.raw_payload,
        data_updated_at = excluded.data_updated_at,
        primary_category = COALESCE(excluded.primary_category, primary_category),
        tagging_version = CASE WHEN excluded.primary_category IS NOT NULL THEN excluded.tagging_version ELSE tagging_version END,
        last_seen_at = excluded.last_seen_at,
        synced_at = excluded.synced_at`;

export function prepareDiscoveryUpsert(
  db: D1Database,
  item: DiscoveryItem,
  syncedAt: string,
): D1PreparedStatement {
  const row = discoveryRow(item, syncedAt);
  return db
    .prepare(DISCOVERY_UPSERT_SQL)
    .bind(
      row.id,
      row.type,
      row.source,
      row.sourceItemId,
      row.title,
      row.subtitle,
      row.categoryText,
      row.startDate,
      row.endDate,
      row.status,
      row.isFree,
      row.venueName,
      row.address,
      row.lat,
      row.lng,
      row.rating,
      row.reviewCount,
      row.lowestPriceText,
      row.lowestPricePlatform,
      row.sourceUrl,
      row.imageUrl,
      row.imagesJson,
      row.tagsJson,
      row.amenitiesJson,
      row.offersJson,
      row.rawPayload,
      row.dataUpdatedAt,
      row.primaryCategory,
      row.taggingVersion,
      syncedAt,
      syncedAt,
      syncedAt,
    );
}

const DISCOVERY_ENRICHMENT_FIELDS = [
  "admissionFee",
  "discountInfo",
  "bookingInfo",
  "contactPhone",
  "ageLimit",
  "programInfo",
  "organizerName",
] as const;

// raw_payload는 매 sync마다 통째로 덮어써지므로, 이번 사이클에 detail
// enrichment 대상으로 선택되지 않아 값이 null인 필드는 D1에 이미 저장된
// 이전 값으로 채워 넣는다. 새 값이 있으면 항상 새 값이 우선한다.
// event 형태 item의 요금(price)도 같은 이유로 보존한다 — 요금 backfill이
// 채워 넣은 값이 다음 sync에서 통째로 날아가면 backfill 자체가 무의미해진다.
async function mergeWithExistingEnrichment(
  db: D1Database,
  items: DiscoveryItem[],
): Promise<DiscoveryItem[]> {
  if (items.length === 0) return items;

  const ids = items.map(discoveryItemId);
  const placeholders = ids.map(() => "?").join(",");
  const rows = await db
    .prepare(
      `SELECT id, raw_payload, lowest_price_text FROM discovery_items WHERE id IN (${placeholders})`,
    )
    .bind(...ids)
    .all<{
      id: string;
      raw_payload: string | null;
      lowest_price_text: string | null;
    }>();

  const existingById = new Map<
    string,
    { raw: Record<string, unknown> | null; priceText: string | null }
  >();
  for (const row of rows.results ?? []) {
    existingById.set(row.id, {
      raw: parseRawPayload(row.raw_payload),
      priceText: row.lowest_price_text,
    });
  }
  if (existingById.size === 0) return items;

  return items.map((item) => {
    const existing = existingById.get(discoveryItemId(item));
    if (!existing) return item;
    if ("eventType" in item) {
      const previousPrice =
        stringFromRaw(existing.raw?.price) ?? existing.priceText;
      if (item.price != null || !previousPrice) return item;
      const restored = normalizeFee(previousPrice);
      return {
        ...item,
        price: previousPrice,
        isFree: item.isFree || restored.feeType === "free",
      };
    }
    const raw = existing.raw;
    if (!raw) return item;
    let changed = false;
    const merged: Festival = { ...item };
    for (const field of DISCOVERY_ENRICHMENT_FIELDS) {
      if (merged[field] == null && typeof raw[field] === "string" && raw[field]) {
        merged[field] = raw[field] as string;
        changed = true;
      }
    }
    if (merged.admissionFee == null && existing.priceText) {
      merged.admissionFee = existing.priceText;
      changed = true;
    }
    return changed ? merged : item;
  });
}

async function upsertDiscoveryItems(
  db: D1Database,
  items: DiscoveryItem[],
  syncedAt: string,
): Promise<number> {
  if (items.length === 0) return 0;
  let upserted = 0;
  for (
    let start = 0;
    start < items.length;
    start += DISCOVERY_UPSERT_BATCH_SIZE
  ) {
    const slice = items.slice(start, start + DISCOVERY_UPSERT_BATCH_SIZE);
    const merged = await mergeWithExistingEnrichment(db, slice);
    const statements = merged.map((item) =>
      prepareDiscoveryUpsert(db, item, syncedAt),
    );
    await db.batch(statements);
    upserted += slice.length;
  }
  return upserted;
}

// discovery_items의 primary key. discoveryRow와 enrichment 병합이 같은 규칙을
// 써야 하므로 한 곳에 둔다.
export function discoveryItemId(item: DiscoveryItem): string {
  return "eventType" in item
    ? `festival:${item.source}:${item.id}`
    : `festival:${item.id}`;
}

export function discoveryRow(
  item: DiscoveryItem,
  syncedAt: string,
): DiscoveryRowPayload {
  const isEvent = "eventType" in item;
  // 요금은 소스별 필드(event.price / festival.admissionFee)를 하나로 정규화해
  // 항상 lowest_price_text + is_free 두 컬럼에 같은 모양으로 넣는다.
  const fee = normalizeFee(isEvent ? item.price : item.admissionFee);
  // Public API events are intentionally folded into the festival discovery domain for one map toggle and one cache type.
  return {
    id: discoveryItemId(item),
    type: "festival",
    source: item.source,
    sourceItemId: item.id,
    title: item.title,
    subtitle: isEvent ? item.shortDescription : item.subtitle,
    categoryText: isEvent ? item.eventType : item.tags.join(","),
    startDate: item.startDate,
    endDate: item.endDate,
    status: item.status,
    isFree: isEvent
      ? item.isFree || fee.feeType === "free"
        ? 1
        : 0
      : feeFreeFlag(fee),
    venueName: item.venueName,
    address: item.address,
    lat: item.lat,
    lng: item.lng,
    rating: null,
    reviewCount: null,
    lowestPriceText: fee.feeText,
    lowestPricePlatform: null,
    sourceUrl: item.sourceUrl,
    imageUrl: item.imageUrl,
    imagesJson:
      item.imageUrls && item.imageUrls.length > 0
        ? JSON.stringify(item.imageUrls)
        : null,
    tagsJson: isEvent ? null : JSON.stringify(item.tags),
    amenitiesJson: null,
    offersJson: null,
    rawPayload: JSON.stringify(item),
    dataUpdatedAt: syncedAt,
    primaryCategory: item.primaryCategory ?? null,
    taggingVersion: item.primaryCategory ? TAGGING_VERSION : 0,
  };
}

async function pruneStaleDiscovery(
  db: D1Database,
  type: DiscoveryType,
): Promise<number> {
  const minSeenAt = new Date(
    Date.now() - DISCOVERY_STALE_DAYS[type] * 24 * 60 * 60 * 1000,
  ).toISOString();
  const result = await db
    .prepare("DELETE FROM discovery_items WHERE type = ? AND last_seen_at < ?")
    .bind(type, minSeenAt)
    .run();
  return result.meta.changes ?? 0;
}

function mapFestivalRow(
  row: DiscoveryItemRow,
  lat: number,
  lng: number,
): Festival {
  const raw = parseRawPayload(row.raw_payload);
  const parsedTags = parseJsonArray<string>(row.tags_json);
  return {
    id: row.source_item_id,
    title: row.title,
    subtitle: row.subtitle,
    description: descriptionFromRaw(raw),
    startDate: row.start_date ?? "",
    endDate: row.end_date ?? row.start_date ?? "",
    status: row.status ?? "upcoming",
    venueName: row.venue_name,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    distanceMeters: distanceMeters(lat, lng, row.lat, row.lng),
    source: row.source,
    sourceUrl: row.source_url,
    imageUrl: row.image_url,
    imageUrls: parseJsonArray<string>(row.images_json),
    tags:
      parsedTags.length > 0
        ? parsedTags
        : (row.category_text ?? "public-culture")
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
    primaryCategory:
      (row.primary_category as Festival["primaryCategory"]) ?? null,
    categoryTags: parseJsonArray<string>(row.category_tags_json),
    // event 형태로 저장된 행(kopis·서울 열린데이터 등)은 요금이 raw_payload가
    // 아니라 lowest_price_text/is_free 컬럼에 있다. /api/festivals가 그 행도
    // 축제로 내보내므로 여기서 같이 읽어 요금이 통째로 누락되지 않게 한다.
    admissionFee:
      textFromRaw(raw?.admissionFee) ??
      textFromRaw(raw?.price) ??
      row.lowest_price_text ??
      (row.is_free === 1 ? "무료" : null),
    discountInfo: textFromRaw(raw?.discountInfo),
    bookingInfo: textFromRaw(raw?.bookingInfo),
    contactPhone: textFromRaw(raw?.contactPhone),
    ageLimit: textFromRaw(raw?.ageLimit),
    programInfo: textFromRaw(raw?.programInfo),
    organizerName: textFromRaw(raw?.organizerName),
  };
}

function parseRawPayload(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function descriptionFromRaw(raw: Record<string, unknown> | null): string | null {
  if (!raw) return null;
  for (const key of ["description", "shortDescription"] as const) {
    const text = stringFromRaw(raw[key]);
    if (text && text.length >= 25) return text;
  }
  return null;
}

function stringFromRaw(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

// Unlike stringFromRaw, keeps internal newlines intact since fields like
// programInfo are pre-formatted multi-line text at write time.
function textFromRaw(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function mapEventRow(
  row: DiscoveryItemRow,
  lat: number,
  lng: number,
): FreeEvent {
  return {
    id: row.source_item_id,
    title: row.title,
    eventType: row.category_text ?? "event",
    category: eventCategory(row.category_text),
    sourceId: row.source_item_id,
    startDate: row.start_date ?? "",
    endDate: row.end_date ?? row.start_date ?? "",
    status: row.status ?? "upcoming",
    isFree: Boolean(row.is_free),
    venueName: row.venue_name,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    distanceMeters: distanceMeters(lat, lng, row.lat, row.lng),
    source: row.source,
    sourceUrl: row.source_url,
    imageUrl: row.image_url,
    shortDescription: row.subtitle,
    price: row.lowest_price_text,
    region: null,
    updatedAt: row.data_updated_at ?? undefined,
    primaryCategory:
      (row.primary_category as FreeEvent["primaryCategory"]) ?? null,
    categoryTags: parseJsonArray<string>(row.category_tags_json),
  };
}

function eventCategory(value: string | null): EventCategory {
  const allowed: EventCategory[] = [
    "festival",
    "performance",
    "exhibition",
    "culture",
    "local_event",
    "other",
  ];
  return allowed.includes(value as EventCategory)
    ? (value as EventCategory)
    : "other";
}

function rowPassesFilters(
  row: DiscoveryItemRow,
  options: DiscoveryQueryOptions,
): boolean {
  if (options.ongoingOnly && row.status !== "ongoing") return false;
  // freeOnly는 event source 행에만 의미가 있어 queryPerformancesFromCache에서 처리한다.
  // (모든 행이 type='festival'로 저장되므로 여기서 걸면 is_free가 NULL인 축제까지 사라진다.)
  if (!row.start_date || !row.end_date) return true;
  const end = Date.parse(row.end_date);
  if (!Number.isFinite(end)) return true;
  const max = Date.now() + options.upcomingWithinDays * 24 * 60 * 60 * 1000;
  const min = startOfToday() - (options.pastWithinDays ?? 0) * 24 * 60 * 60 * 1000;
  return end >= min && Date.parse(row.start_date) <= max;
}

function sortDiscoveryRows(
  a: DiscoveryItemRow,
  b: DiscoveryItemRow,
  lat: number,
  lng: number,
): number {
  if (a.status !== b.status) {
    if (a.status === "ongoing") return -1;
    if (b.status === "ongoing") return 1;
  }
  return (
    distanceMeters(lat, lng, a.lat, a.lng) -
    distanceMeters(lat, lng, b.lat, b.lng)
  );
}

function dedupeItems<T extends DiscoveryItem>(items: T[]): T[] {
  const selected = new Map<string, T>();
  for (const item of items) {
    const type = "eventType" in item ? "event" : "festival";
    selected.set(`${type}:${item.source}:${item.id}`, item);
  }
  return [...selected.values()];
}

function countSources(items: DiscoveryItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.source] = (counts[item.source] ?? 0) + 1;
  }
  return counts;
}

async function startSyncRun(
  db: D1Database,
  syncType: string,
): Promise<{ id: string }> {
  const id = `${syncType}:${crypto.randomUUID()}`;
  await db
    .prepare(
      "INSERT INTO sync_runs (id, sync_type, started_at, status) VALUES (?, ?, ?, ?)",
    )
    .bind(id, syncType, new Date().toISOString(), "running")
    .run();
  return { id };
}

export async function reapStaleSyncRuns(
  db: D1Database,
  olderThanMs: number = 10 * 60 * 1000,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const result = await db
    .prepare(
      `UPDATE sync_runs
         SET finished_at = ?, status = 'timeout', message = COALESCE(message, 'reaped: stale running')
         WHERE status = 'running' AND started_at < ?`,
    )
    .bind(new Date().toISOString(), cutoff)
    .run();
  const changes =
    (result.meta as { changes?: number } | undefined)?.changes ?? 0;
  if (changes > 0) {
    console.info(`reapStaleSyncRuns marked ${changes} stale runs as timeout`);
  }
  return changes;
}

async function fetchDiscoveryCenterWithTimeout(
  runtime: DiscoverySyncRuntime,
  kind: DiscoverySyncKind,
  centerId: string,
  query: SyncDiscoverQuery,
  fetchTimeoutMs?: number,
): Promise<{ items: DiscoveryItem[]; timedOut: boolean }> {
  const timeoutMs = fetchTimeoutMs ?? discoverySyncFetchTimeoutMs();
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const work =
    kind === "festivals"
      ? runtime.festivalService.nearby({ ...query, signal: controller.signal })
      : runtime.eventService.nearby({ ...query, signal: controller.signal });
  const guardedWork = work.then(
    (items) => ({ items, timedOut: false }),
    (error) => {
      if (controller.signal.aborted) return { items: [], timedOut: true };
      throw error;
    },
  );
  const timeout = new Promise<{ items: DiscoveryItem[]; timedOut: boolean }>(
    (resolve) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        console.info(
          `discovery sync ${kind} center=${centerId} timed out after ${timeoutMs}ms`,
        );
        resolve({ items: [], timedOut: true });
      }, timeoutMs);
    },
  );
  try {
    return await Promise.race([guardedWork, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function discoverySyncConcurrency(): number {
  return positiveIntegerFromEnv(
    "DISCOVERY_SYNC_CONCURRENCY",
    DEFAULT_DISCOVERY_SYNC_CONCURRENCY,
  );
}

function discoverySyncFetchTimeoutMs(): number {
  return positiveIntegerFromEnv(
    "DISCOVERY_SYNC_FETCH_TIMEOUT_MS",
    DEFAULT_DISCOVERY_SYNC_FETCH_TIMEOUT_MS,
  );
}

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

async function finishSyncRun(
  db: D1Database,
  id: string,
  status: "success" | "failed" | "timeout",
  result: DiscoverySyncResult,
  message: string | null = null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE sync_runs
       SET finished_at = ?, status = ?, fetched = ?, upserted = ?, skipped = ?, pruned = ?, message = ?
       WHERE id = ?`,
    )
    .bind(
      new Date().toISOString(),
      status,
      result.fetched,
      result.upserted,
      result.skipped,
      result.pruned,
      message,
      id,
    )
    .run();
}

function parseJsonArray<T>(value: string | null): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function startOfToday(): number {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
