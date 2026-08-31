import { Hono } from "hono";
import { cors } from "hono/cors";
import { z, ZodError } from "zod";
import type { MapItem, DiscoverPerformancesResponse } from "@parking/shared-types";
import { syncNationalParkingPage } from "./nationalParkingSync.js";
import { timingSafeStringEqual } from "./security.js";
import {
  currentDiscoveryChunkIndex,
  DISCOVERY_PROVIDER_CHUNK_COUNT,
  queryDiscoveryClusters,
  getFestivalBySourceItemId,
  queryFestivalsFromCache,
  queryPerformancesFromCache,
  pruneOldSyncRuns,
  reapStaleSyncRuns,
  syncDiscoveryCache,
  syncDiscoveryChunk,
  type DiscoveryQueryOptions,
} from "./discoveryCache.js";
import {
  createAdminLocalEvent,
  createLocalEventReport,
  getLocalEvent,
  localEventMapItem,
  patchLocalEventStatus,
  queryLocalEvents,
  updateAdminLocalEvent,
} from "./localEvents.js";
import { syncLocalEventDiscovery } from "./localEventDiscovery.js";
import { runCityFestivalDiscovery } from "./cityFestivalDiscovery.js";
import { CITY_FESTIVAL_SITES } from "./cityFestivalSites.js";
import {
  currentCityFestivalChunkIndex,
  sitesForChunk,
  CITY_FESTIVAL_CHUNK_SIZE
} from "./cityFestivalSchedule.js";
import { CityScrapedFestivalProvider } from "./cityScrapedFestivalProvider.js";
import { runAkeiTradeExpoDiscovery } from "./akeiTradeExpoDiscovery.js";
import { AkeiTradeExpoFestivalProvider } from "./akeiTradeExpoProvider.js";
import { runFeeBackfill } from "./feeBackfill.js";
import { runImageBackfill } from "./imageBackfill.js";
import { runGeocodeBackfill } from "./geocodeBackfill.js";
import { runHeadReview } from "./agents/headAgent.js";
import { runImageEnrichment } from "./agents/imageAgent.js";
import { runTagging } from "./llmTagging.js";
import { createMerchantApp } from "./merchant/routes.js";
import { createLegalApp } from "./legal/routes.js";
import {
  createEventReport,
  eventReportSchema,
  patchEventReportStatus,
  queryEventReports,
} from "./eventReports.js";
import {
  analyticsBatchSchema,
  pruneOldAnalytics,
  queryAnalyticsDaily,
  recordAnalytics,
} from "./analytics.js";
import {
  queryRealtimeParkingCache,
  queryRealtimeParkingClusters,
  syncRealtimeParkingCache,
} from "./realtimeParkingCache.js";
import { queryStaticParkingCache } from "./staticParkingCache.js";
import { createD1GeocodeStore } from "./geocodeStore.js";
import { queryPipelineStats } from "./pipelineStats.js";
import { apnsConfigFromEnv, createApnsSender } from "./apns.js";
import {
  dispatchPendingNotifications,
  planUpcomingNotifications,
} from "./upcomingNotifications.js";
import { registerNotificationDevice } from "./notificationRegistration.js";

export type Env = {
  DB?: D1Database;
  SYNC_ADMIN_TOKEN?: string;
  NODE_ENV: string;
  LOG_LEVEL: string;
  PARKING_PROVIDER_MODE: "mock" | "real" | "hybrid";
  DEFAULT_SEARCH_RADIUS_METERS: string;
  DEFAULT_DISCOVER_RADIUS_METERS: string;
  STALE_THRESHOLD_SECONDS: string;
  CACHE_TTL_SECONDS: string;
  DISCOVER_CACHE_TTL_SECONDS: string;
  DISCOVERY_SYNC_CONCURRENCY?: string;
  DISCOVERY_SYNC_FETCH_TIMEOUT_MS?: string;
  FESTIVAL_PROVIDER_ENABLED: string;
  EVENT_PROVIDER_ENABLED: string;
  LOCAL_EVENT_PROVIDER_ENABLED: string;
  LOCAL_EVENT_AUTO_APPROVE_MIN_SCORE: string;
  CITY_FESTIVAL_AUTO_PUBLISH_MIN_SCORE?: string;
  CITY_FESTIVAL_GEOCODE_MISS_BUDGET?: string;
  CITY_FESTIVAL_DETAIL_FETCH_BUDGET?: string;
  LOCAL_EVENT_SEARCH_MAX_QUERIES: string;
  NAVER_CLIENT_ID?: string;
  NAVER_CLIENT_SECRET?: string;
  NAVER_SEARCH_BASE_URL: string;
  KAKAO_REST_API_KEY?: string;
  KAKAO_LOCAL_BASE_URL: string;
  SEOUL_OPEN_DATA_KEY?: string;
  SEOUL_OPEN_DATA_BASE_URL: string;
  SEOUL_SEONGDONG_IOT_KEY?: string;
  SEOUL_HANGANG_PARKING_KEY?: string;
  PUBLIC_DATA_SERVICE_KEY?: string;
  PUBLIC_DATA_ENV: "development" | "production";
  PUBLIC_DATA_BASE_URL: string;
  CULTURE_PORTAL_API_KEY?: string;
  KOPIS_API_KEY?: string;
  KOPIS_BASE_URL: string;
  FEE_BACKFILL_MAX_ITEMS?: string;
  IMAGE_BACKFILL_MAX_ITEMS?: string;
  GEOCODE_BACKFILL_MAX_LOOKUPS?: string;
  KCISA_428_API_KEY?: string;
  KCISA_196_API_KEY?: string;
  KCISA_BASE_URL: string;
  NATIONAL_PARKING_DATA_BASE_URL?: string;
  MERCHANT_SESSION_SECRET?: string;
  MERCHANT_PUBLIC_BASE_URL?: string;
  AI?: Ai;
  AGENT_HEAD_ENABLED?: string;
  AGENT_HEAD_BATCH_SIZE?: string;
  AGENT_HEAD_MAX_BATCHES?: string;
  AGENT_HEAD_INCLUDE_REJECTED?: string;
  AGENT_PIXEL_ENABLED?: string;
  AGENT_PIXEL_BATCH_SIZE?: string;
  TAGGING_MODEL?: string;
  TAGGING_BATCH_SIZE?: string;
  TAGGING_RUN_MAX_ROWS?: string;
  TAGGING_CONCURRENCY?: string;
  OPS_ALERT_WEBHOOK_URL?: string;
  // APNs (다가오는 행사 알림 서버 발송). 넷 중 하나라도 없으면 발송을 건너뛴다.
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_PRIVATE_KEY?: string;
  APNS_BUNDLE_ID?: string;
  UPCOMING_NOTIFICATION_MAX_PUSHES?: string;
};

type BackendModules = {
  searchDestination: typeof import("../../backend/src/services/destinationSearch.js").searchDestination;
  createCompositeParkingProvider: typeof import("../../backend/src/providers/createProviders.js").createCompositeParkingProvider;
  createRealtimeParkingProvider: typeof import("../../backend/src/providers/createProviders.js").createRealtimeParkingProvider;
  createFestivalService: typeof import("../../backend/src/features/discover/festivals/festivalService.js").createFestivalService;
  createEventService: typeof import("../../backend/src/features/discover/events/eventService.js").createEventService;
  SearchHistoryService: typeof import("../../backend/src/features/analytics/searchHistoryService.js").SearchHistoryService;
  searchHistoryRepository: typeof import("../../backend/src/features/analytics/SearchHistoryRepository.js").searchHistoryRepository;
};

type BackendRuntime = {
  searchDestination: BackendModules["searchDestination"];
  parkingProvider: ReturnType<BackendModules["createCompositeParkingProvider"]>;
  realtimeParkingProvider: ReturnType<
    BackendModules["createRealtimeParkingProvider"]
  >;
  festivalService: ReturnType<BackendModules["createFestivalService"]>;
  eventService: ReturnType<BackendModules["createEventService"]>;
  searchHistoryService: InstanceType<BackendModules["SearchHistoryService"]>;
};

const app = new Hono<{ Bindings: Env }>();
let backendRuntime: Promise<BackendRuntime> | null = null;
let realtimeProviderPromise: Promise<
  BackendRuntime["realtimeParkingProvider"]
> | null = null;
let discoveryRuntimePromise: Promise<{
  festivalService: BackendRuntime["festivalService"];
  eventService: BackendRuntime["eventService"];
}> | null = null;

const optionalBoolean = z
  .enum(["true", "false"])
  .transform((value) => value === "true")
  .optional();

const searchQuerySchema = z.object({
  q: z.string().min(1),
});

const parkingNearbySchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  radiusMeters: z.coerce.number().optional(),
  clusterMeters: z.coerce.number().min(250).max(50000).optional(),
  preferPublic: optionalBoolean,
  evOnly: optionalBoolean,
  accessibleOnly: optionalBoolean,
  bestWalkingDistanceBias: optionalBoolean,
});

const discoverQuerySchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  radiusMeters: z.coerce.number().optional(),
  ongoingOnly: optionalBoolean,
  upcomingWithinDays: z.coerce.number().min(0).max(365).optional(),
  pastWithinDays: z.coerce.number().min(0).max(90).optional(),
  freeOnly: optionalBoolean,
});

const localEventQuerySchema = discoverQuerySchema.extend({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).default(200),
});

const mapItemsQuerySchema = localEventQuerySchema.extend({
  type: z.enum(["festival", "event", "all"]).default("all"),
});

const eventSourceSchema = z.enum([
  "instagram",
  "naver_place",
  "owner_submitted",
  "admin_manual",
  "user_report",
  "official_site",
  "other",
]);
const eventStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "expired",
]);
const eventTypeSchema = z.enum([
  "discount",
  "freebie",
  "review_event",
  "popup",
  "limited_menu",
  "opening_event",
  "etc",
]);

const localEventReportSchema = z.object({
  sourceUrl: z.string().url().nullable().optional(),
  captionText: z.string().max(5000).nullable().optional(),
  storeName: z.string().max(200).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
});

const adminLocalEventSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  benefit: z.string().max(500).optional(),
  startDate: z.string().optional(),
  endDate: z.string().nullable().optional(),
  storeName: z.string().min(1).max(200).optional(),
  address: z.string().max(500).optional(),
  // 좌표를 직접 주지 않을 때 상호명만으로는 동명 매장이 엉뚱하게 잡힌다.
  // Kakao 조회에 붙일 지역 힌트("서울 성수동" 등)로만 쓴다.
  region: z.string().max(80).nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  source: eventSourceSchema,
  sourceUrl: z.string().url().nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  eventType: eventTypeSchema.optional(),
  status: eventStatusSchema.optional(),
  isSponsored: z.boolean().optional(),
  sponsorTier: z.string().max(80).nullable().optional(),
  paidUntil: z.string().nullable().optional(),
  priorityScore: z.number().int().min(0).max(10000).optional(),
});

const adminLocalEventPatchSchema = adminLocalEventSchema.partial().extend({
  source: eventSourceSchema.optional(),
});

const localEventStatusPatchSchema = z.object({
  status: eventStatusSchema,
  rejectionReason: z.string().max(1000).nullable().optional(),
});

const discoveryClusterSchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  radiusMeters: z.coerce.number().optional(),
  clusterMeters: z.coerce.number().min(250).max(100000).optional(),
  types: z.string().optional(),
});

const discoverySyncSchema = z.object({
  kinds: z.string().optional(),
  chunkIndex: z.coerce.number().int().min(0).max(63).optional(),
});

const localEventDiscoverySyncSchema = z.object({
  dryRun: optionalBoolean,
  chunkIndex: z.coerce.number().int().min(0).max(63).optional(),
  chunkCount: z.coerce.number().int().min(1).max(64).optional(),
});

const cityFestivalDiscoverySyncSchema = z.object({
  chunkIndex: z.coerce.number().int().min(0).max(63).optional(),
})

const feeBackfillSchema = z.object({
  maxItems: z.coerce.number().int().min(1).max(45).optional(),
});

// 조회 한 건이 subrequest 한 건이라 요금 backfill과 같은 상한을 쓴다.
const imageBackfillSchema = z.object({
  maxItems: z.coerce.number().int().min(1).max(45).optional(),
});

// 조회 한 건이 subrequest 한 건이라 invocation당 50건 예산 안에 들어와야 한다.
const geocodeBackfillSchema = z.object({
  maxLookups: z.coerce.number().int().min(1).max(40).optional(),
});

const LOCAL_EVENT_CHUNK_COUNT = 12;

const syncNationalParkingSchema = z.object({
  pageNo: z.coerce.number().int().min(1).default(1),
  numOfRows: z.coerce.number().int().min(1).max(1000).default(500),
  dryRun: optionalBoolean,
});

const placeCategorySchema = z.enum([
  "restaurant",
  "cafe",
  "tourist_spot",
  "shopping",
  "hospital",
  "office",
  "market",
  "station",
  "hotel",
  "school",
  "other",
]);

const createSearchHistorySchema = z.object({
  deviceId: z.string().min(8).max(128),
  userId: z.string().max(128).nullable().optional(),
  queryText: z.string().min(1).max(200),
  destinationId: z.string().max(200).nullable().optional(),
  destinationName: z.string().min(1).max(200),
  address: z.string().max(300),
  lat: z.number(),
  lng: z.number(),
  selectedAt: z.string().datetime().optional(),
  normalizedCategory: placeCategorySchema.optional(),
  rawCategory: z.string().max(300).nullable().optional(),
  provider: z.string().max(80).nullable().optional(),
});

const listQuerySchema = z.object({
  deviceId: z.string().min(8).max(128).optional(),
});

// 앱이 쓰는 공개 API에만 CORS를 연다. admin 경로는 Bearer 토큰으로 보호되지만,
// 브라우저에서 임의 origin이 응답 본문을 읽을 이유가 없으므로 CORS 헤더를 주지 않는다.
const publicCors = cors();
app.use("*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path === "/admin" || path.startsWith("/admin/")) return next();
  if (path === "/api/admin" || path.startsWith("/api/admin/")) return next();
  return publicCors(c, next);
});

app.route("/merchant", createMerchantApp());
app.route("/legal", createLegalApp());

app.onError((error, c) => {
  if (error instanceof ZodError) {
    return c.json({ error: "bad_request", issues: error.issues }, 400);
  }
  // 목적지 검색은 실패를 mock 좌표로 감추지 않는다. 앱이 구분할 수 있게 503으로 내려보낸다.
  if ((error as { code?: string }).code === "destination_search_unavailable") {
    console.error(error);
    return c.json({ error: "destination_search_unavailable" }, 503);
  }
  console.error(error);
  return c.json({ error: "internal_error" }, 500);
});

app.get("/", (c) =>
  c.json({ status: "ok", generatedAt: new Date().toISOString() }),
);

app.get("/health", (c) =>
  c.json({ status: "ok", generatedAt: new Date().toISOString() }),
);

app.get("/search/destination", async (c) => {
  const query = searchQuerySchema.parse({ q: c.req.query("q") });
  const backend = await loadBackend(c.env);
  const items = await backend.searchDestination(query.q);
  return c.json({ items });
});

app.get("/parking/nearby", async (c) => {
  const query = parkingNearbySchema.parse(queryObject(c.req.raw.url));
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const radiusMeters =
    query.radiusMeters ?? Number(c.env.DEFAULT_SEARCH_RADIUS_METERS);
  const options = {
    radiusMeters,
    preferPublic: query.preferPublic,
    evOnly: query.evOnly,
    accessibleOnly: query.accessibleOnly,
    bestWalkingDistanceBias: query.bestWalkingDistanceBias,
  };
  const items = await queryStaticParkingCache(
    c.env.DB,
    query.lat,
    query.lng,
    options,
  );
  return c.json({
    destination: { lat: query.lat, lng: query.lng, radiusMeters },
    items,
    generatedAt: new Date().toISOString(),
  });
});

app.get("/parking/providers/health", async (c) => {
  const backend = await loadBackend(c.env);
  return c.json({
    providers: backend.parkingProvider.health(),
    generatedAt: new Date().toISOString(),
  });
});

app.get("/parking/realtime", async (c) => {
  const query = parkingNearbySchema.parse(queryObject(c.req.raw.url));
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const radiusMeters =
    query.radiusMeters ?? Number(c.env.DEFAULT_SEARCH_RADIUS_METERS);
  const options = { radiusMeters };
  const items = await queryRealtimeParkingCache(
    c.env.DB,
    query.lat,
    query.lng,
    options,
  );
  return c.json({
    destination: { lat: query.lat, lng: query.lng, radiusMeters },
    items,
    generatedAt: new Date().toISOString(),
  });
});

app.get("/parking/realtime/clusters", async (c) => {
  const query = parkingNearbySchema.parse(queryObject(c.req.raw.url));
  if (!c.env.DB) {
    return c.json({ error: "d1_not_configured" }, 503);
  }
  const radiusMeters =
    query.radiusMeters ?? Number(c.env.DEFAULT_SEARCH_RADIUS_METERS);
  const clusterMeters = query.clusterMeters ?? 5000;
  const clusters = await queryRealtimeParkingClusters(
    c.env.DB,
    query.lat,
    query.lng,
    { radiusMeters },
    clusterMeters,
  );
  return c.json({
    destination: { lat: query.lat, lng: query.lng, radiusMeters },
    clusterMeters,
    clusters,
    generatedAt: new Date().toISOString(),
  });
});

app.post("/admin/sync-realtime-parking", async (c) => {
  const authResponse = authorizeAdminSync(c.req.raw, c.env);
  if (authResponse) return authResponse;
  if (!c.env.DB) {
    return c.json({ error: "d1_not_configured" }, 503);
  }

  const backend = await loadBackend(c.env);
  try {
    const result = await syncRealtimeParkingCache(
      c.env.DB,
      backend.realtimeParkingProvider,
    );
    return c.json(result);
  } catch (error) {
    return c.json(syncErrorResponse(error), 502);
  }
});

app.post("/analytics/search-history", async (c) => {
  const body = createSearchHistorySchema.parse(await c.req.json());
  const backend = await loadBackend(c.env);
  const record = await backend.searchHistoryService.create(body);
  return c.json(record, 201);
});

app.get("/analytics/search-history", async (c) => {
  const query = listQuerySchema.parse(queryObject(c.req.raw.url));
  const backend = await loadBackend(c.env);
  return c.json({
    items: await backend.searchHistoryService.list(query.deviceId),
    generatedAt: new Date().toISOString(),
  });
});

app.get("/analytics/search-history/stats", async (c) => {
  const query = listQuerySchema.parse(queryObject(c.req.raw.url));
  const backend = await loadBackend(c.env);
  return c.json(await backend.searchHistoryService.stats(query.deviceId));
});

app.get("/discover/festivals", async (c) => {
  const query = discoverQuerySchema.parse(queryObject(c.req.raw.url));
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const items = await queryFestivalsFromCache(c.env.DB, query.lat, query.lng, {
    radiusMeters:
      query.radiusMeters ?? Number(c.env.DEFAULT_DISCOVER_RADIUS_METERS),
    ongoingOnly: query.ongoingOnly,
    upcomingWithinDays: query.upcomingWithinDays ?? 30,
  });
  return c.json({
    items: items.map((item) => ({
      ...item,
      description: item.description ?? item.subtitle ?? null,
    })),
    generatedAt: new Date().toISOString(),
  });
});

// 짧은 TTL 엣지 캐시. 클라이언트로 반환하는 응답 본문/상태는 그대로 두고(동작 불변),
// 캐시 저장본에만 Cache-Control을 부여해 colo 단위로 재사용한다. 200 응답만 캐시한다.
// 캐시 윈도우(ttlSeconds) 내에서는 cron 동기화로 갱신된 데이터가 그만큼 늦게 보일 수 있다.
async function edgeCached(
  url: string,
  ctx: ExecutionContext,
  ttlSeconds: number,
  build: () => Promise<Response>,
): Promise<Response> {
  // Workers 런타임 전용 caches.default (DOM CacheStorage 타입엔 없어 캐스트).
  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(url, { method: "GET" });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  const res = await build();
  if (res.status === 200) {
    const buf = await res.clone().arrayBuffer();
    const headers = new Headers(res.headers);
    headers.set("Cache-Control", `public, max-age=${ttlSeconds}`);
    ctx.waitUntil(cache.put(cacheKey, new Response(buf, { status: 200, headers })));
  }
  return res;
}

app.get("/api/festivals", async (c) =>
  edgeCached(c.req.url, c.executionCtx, 60, async () => {
    const query = discoverQuerySchema.parse(queryObject(c.req.raw.url));
    if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
    const items = await queryFestivalsFromCache(c.env.DB, query.lat, query.lng, {
      radiusMeters:
        query.radiusMeters ?? Number(c.env.DEFAULT_DISCOVER_RADIUS_METERS),
      ongoingOnly: query.ongoingOnly,
      upcomingWithinDays: query.upcomingWithinDays ?? 30,
      pastWithinDays: query.pastWithinDays ?? 0,
    });
    return c.json({
      items: items.map((item) => ({
        ...item,
        description: item.description ?? item.subtitle ?? null,
      })),
      generatedAt: new Date().toISOString(),
    });
  }),
);

// 푸시 알림은 전체 JSON 대신 eventKind + eventId만 싣는다. 앱이 그 id로 상세를 받는다.
app.get("/api/festivals/:id", async (c) => {
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const item = await getFestivalBySourceItemId(c.env.DB, c.req.param("id"));
  if (!item) return c.json({ error: "not_found" }, 404);
  return c.json({ item, generatedAt: new Date().toISOString() });
});

app.get("/api/performances", async (c) => {
  if (!c.env.DB) return c.json({ error: "DB not configured" }, 503);
  const query = discoverQuerySchema.safeParse(queryObject(c.req.raw.url));
  if (!query.success) return c.json({ error: "Invalid query" }, 400);
  const { lat, lng, radiusMeters, upcomingWithinDays } = query.data;
  const options: DiscoveryQueryOptions = {
    radiusMeters: radiusMeters ?? 50_000,
    upcomingWithinDays: upcomingWithinDays ?? 365,
  };
  const { festivals, events } = await queryPerformancesFromCache(
    c.env.DB,
    lat,
    lng,
    options,
  );
  return c.json({
    festivals,
    events,
    generatedAt: new Date().toISOString(),
  } satisfies DiscoverPerformancesResponse);
});

app.get("/api/local-events", async (c) =>
  edgeCached(c.req.url, c.executionCtx, 60, async () => {
    const query = localEventQuerySchema.parse(queryObject(c.req.raw.url));
    if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
    const result = await queryLocalEvents(c.env.DB, {
      lat: query.lat,
      lng: query.lng,
      radiusMeters:
        query.radiusMeters ?? Number(c.env.DEFAULT_DISCOVER_RADIUS_METERS),
      cursor: query.cursor,
      limit: query.limit,
      status: "approved",
    });
    return c.json({ ...result, generatedAt: new Date().toISOString() });
  }),
);

app.get("/api/local-events/:id", async (c) => {
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const item = await getLocalEvent(c.env.DB, c.req.param("id"));
  if (!item || item.status !== "approved")
    return c.json({ error: "not_found" }, 404);
  if (item.isSponsored) {
    const now = new Date().toISOString();
    if (!item.paidUntil || item.paidUntil <= now)
      return c.json({ error: "not_found" }, 404);
  }
  return c.json({ item, generatedAt: new Date().toISOString() });
});

// 알림 설정 동기화. 앱이 켤 때·설정을 바꿀 때·APNs 토큰이 바뀔 때마다 전체 상태를 보낸다.
// 로그인 시스템이 없으므로 앱이 만든 익명 device id를 키로 upsert한다.
const notificationRegisterSchema = z.object({
  deviceId: z.string().min(8).max(128),
  apnsToken: z.string().max(200).nullish(),
  apnsEnvironment: z.enum(["production", "sandbox"]).default("production"),
  festival: z
    .object({
      enabled: z.boolean().default(false),
      regions: z.array(z.string().max(40)).max(300).default([]),
      categories: z.array(z.string().max(40)).max(50).default([]),
    })
    .default({ enabled: false, regions: [], categories: [] }),
  localEvent: z
    .object({
      enabled: z.boolean().default(false),
      regions: z.array(z.string().max(40)).max(300).default([]),
      categories: z.array(z.string().max(40)).max(50).default([]),
    })
    .default({ enabled: false, regions: [], categories: [] }),
  quietHours: z
    .object({
      enabled: z.boolean().default(false),
      startHour: z.number().int().min(0).max(23).default(22),
      endHour: z.number().int().min(0).max(23).default(8),
    })
    .default({ enabled: false, startHour: 22, endHour: 8 }),
});

app.post("/api/notifications/register", async (c) => {
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const body = notificationRegisterSchema.parse(await c.req.json());
  const now = new Date().toISOString();
  const { transferredFrom } = await registerNotificationDevice(
    c.env.DB,
    {
      deviceId: body.deviceId,
      apnsToken: body.apnsToken ?? null,
      apnsEnvironment: body.apnsEnvironment,
      festival: body.festival,
      localEvent: body.localEvent,
      quietHours: body.quietHours,
    },
    now,
  );
  return c.json({ ok: true, transferredFrom, generatedAt: now });
});

app.post("/api/local-events/report", async (c) => {
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const item = await createLocalEventReport(
    c.env.DB,
    localEventReportSchema.parse(await c.req.json()),
  );
  return c.json({ item, generatedAt: new Date().toISOString() }, 202);
});

// 행사 정보 오류 신고. 위 /api/local-events/report는 "새 이벤트를 제보"하는
// 통로라 의미가 다르다 - 이쪽은 이미 실린 행사의 내용이 틀렸다는 신고다.
app.post("/api/event-reports", async (c) => {
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const item = await createEventReport(
    c.env.DB,
    eventReportSchema.parse(await c.req.json()),
  );
  return c.json({ item, generatedAt: new Date().toISOString() }, 202);
});

app.get("/api/admin/event-reports", async (c) => {
  const authResponse = authorizeAdminSync(c.req.raw, c.env);
  if (authResponse) return authResponse;
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const params = queryObject(c.req.raw.url);
  const items = await queryEventReports(c.env.DB, {
    status: typeof params.status === "string" ? params.status : undefined,
    limit: typeof params.limit === "string" ? Number(params.limit) : undefined,
  });
  return c.json({ items, generatedAt: new Date().toISOString() });
});

app.patch("/api/admin/event-reports/:id", async (c) => {
  const authResponse = authorizeAdminSync(c.req.raw, c.env);
  if (authResponse) return authResponse;
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const body = z
    .object({ status: z.enum(["pending", "accepted", "rejected"]) })
    .parse(await c.req.json());
  const updated = await patchEventReportStatus(
    c.env.DB,
    c.req.param("id"),
    body.status,
  );
  if (!updated) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true, generatedAt: new Date().toISOString() });
});

// 익명 집계. 앱은 응답을 기다리지 않으므로 실패해도 조용히 넘어간다.
app.post("/api/analytics", async (c) => {
  if (!c.env.DB) return c.json({ ok: true, accepted: 0 });
  const accepted = await recordAnalytics(
    c.env.DB,
    analyticsBatchSchema.parse(await c.req.json()),
  );
  return c.json({ ok: true, accepted });
});

app.get("/api/admin/analytics", async (c) => {
  const authResponse = authorizeAdminSync(c.req.raw, c.env);
  if (authResponse) return authResponse;
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const params = queryObject(c.req.raw.url);
  const days = typeof params.days === "string" ? Number(params.days) : 14;
  const rows = await queryAnalyticsDaily(
    c.env.DB,
    Number.isFinite(days) ? days : 14,
  );
  return c.json({ items: rows, generatedAt: new Date().toISOString() });
});

// 수동 등록은 가게 이름만 주는 경우가 대부분이다. 좌표가 없으면 lat/lng이 0으로
// 저장돼 지도에서 영영 안 보이므로, 여기서 Kakao Local로 한 번 찾아 채운다.
// 끝내 못 찾으면 0,0으로 묻지 말고 422로 돌려보내 등록자가 좌표를 직접 주게 한다.
async function resolveAdminLocalEventCoordinates(
  env: Env,
  input: z.infer<typeof adminLocalEventSchema>,
): Promise<z.infer<typeof adminLocalEventSchema>> {
  if (input.lat != null && input.lng != null) return input;
  const storeName = input.storeName?.trim();
  if (!storeName) return input;
  if (!env.KAKAO_REST_API_KEY || env.PARKING_PROVIDER_MODE === "mock") return input;

  const { KakaoEventCoordinateResolver, setGeocodeStore } = await import(
    "../../backend/src/features/discover/events/eventProviderUtils.js"
  );
  if (env.DB) setGeocodeStore(createD1GeocodeStore(env.DB));
  // 후보 질의(주소 / 지역+상호 / 상호)를 몇 번 시도할 수 있게만 열어 둔다.
  const resolver = new KakaoEventCoordinateResolver(env, { missBudget: 3 });
  const resolved = await resolver.resolve({
    title: input.title ?? storeName,
    venue: storeName,
    address: input.address ?? null,
    region: input.region ?? null,
  });
  await resolver.flush();
  if (!resolved) return input;
  return {
    ...input,
    lat: resolved.lat,
    lng: resolved.lng,
    address: input.address ?? resolved.address ?? undefined,
  };
}

app.post("/api/admin/local-events", async (c) => {
  const authResponse = authorizeAdminSync(c.req.raw, c.env);
  if (authResponse) return authResponse;
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const parsed = adminLocalEventSchema.parse(await c.req.json());
  const input = await resolveAdminLocalEventCoordinates(c.env, parsed);
  if (input.lat == null || input.lng == null) {
    return c.json(
      { error: "coordinates_unresolved", storeName: input.storeName ?? null },
      422,
    );
  }
  const item = await createAdminLocalEvent(c.env.DB, input);
  return c.json({ item, generatedAt: new Date().toISOString() }, 201);
});

app.patch("/api/admin/local-events/:id/status", async (c) => {
  const authResponse = authorizeAdminSync(c.req.raw, c.env);
  if (authResponse) return authResponse;
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const item = await patchLocalEventStatus(
    c.env.DB,
    c.req.param("id"),
    localEventStatusPatchSchema.parse(await c.req.json()),
  );
  if (!item) return c.json({ error: "not_found" }, 404);
  return c.json({ item, generatedAt: new Date().toISOString() });
});

app.patch("/api/admin/local-events/:id", async (c) => {
  const authResponse = authorizeAdminSync(c.req.raw, c.env);
  if (authResponse) return authResponse;
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const item = await updateAdminLocalEvent(
    c.env.DB,
    c.req.param("id"),
    adminLocalEventPatchSchema.parse(await c.req.json()),
  );
  if (!item) return c.json({ error: "not_found" }, 404);
  return c.json({ item, generatedAt: new Date().toISOString() });
});

app.get("/api/map/items", async (c) =>
  edgeCached(c.req.url, c.executionCtx, 60, async () => {
  const query = mapItemsQuerySchema.parse(queryObject(c.req.raw.url));
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const radiusMeters =
    query.radiusMeters ?? Number(c.env.DEFAULT_DISCOVER_RADIUS_METERS);
  const items: MapItem[] = [];
  if (query.type === "festival" || query.type === "all") {
    const festivals = await queryFestivalsFromCache(
      c.env.DB,
      query.lat,
      query.lng,
      {
        radiusMeters,
        ongoingOnly: query.ongoingOnly,
        upcomingWithinDays: query.upcomingWithinDays ?? 30,
      },
    );
    items.push(
      ...festivals.map((item) => ({
        id: `festival:${item.id}`,
        type: "festival" as const,
        title: item.title,
        subtitle: item.subtitle ?? item.venueName ?? item.address,
        lat: item.lat,
        lng: item.lng,
        distanceMeters: item.distanceMeters,
        markerType: "festival" as const,
        source: item.source,
        sourceUrl: item.sourceUrl,
        imageUrl: item.imageUrl,
      })),
    );
  }
  if (query.type === "event" || query.type === "all") {
    const events = await queryLocalEvents(c.env.DB, {
      lat: query.lat,
      lng: query.lng,
      radiusMeters,
      cursor: query.cursor,
      limit: query.limit,
      status: "approved",
    });
    items.push(...events.items.map(localEventMapItem));
  }
  return c.json({
    items: items.sort(
      (a, b) =>
        (b.priorityScore ?? 0) - (a.priorityScore ?? 0) ||
        a.distanceMeters - b.distanceMeters,
    ),
    generatedAt: new Date().toISOString(),
  });
  }),
);

app.get("/discover/clusters", async (c) => {
  const query = discoveryClusterSchema.parse(queryObject(c.req.raw.url));
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const radiusMeters = query.radiusMeters ?? 460000;
  const clusterMeters = query.clusterMeters ?? 20000;
  const types = discoveryClusterTypes(query.types);
  const clusters = await queryDiscoveryClusters(
    c.env.DB,
    types,
    query.lat,
    query.lng,
    { radiusMeters },
    clusterMeters,
  );
  return c.json({
    destination: { lat: query.lat, lng: query.lng, radiusMeters },
    clusterMeters,
    clusters,
    generatedAt: new Date().toISOString(),
  });
});

app.get("/discover/providers/health", async (c) => {
  const backend = await loadBackend(c.env);
  const declared = [
    ...backend.festivalService.health(),
    ...backend.eventService.health(),
  ];
  // provider.health()는 isolate 메모리의 circuit breaker 상태다. Worker isolate는
  // 요청마다 새로 뜨는 것이나 마찬가지라 이 값은 항상 status="up", lastSuccessAt=null로
  // 나왔고, 그래서 이 엔드포인트로는 무엇이 죽었는지 알 수 없었다.
  // 실제 상태는 D1의 sync_runs에만 남으므로 최근 24시간 결과로 덮어쓴다.
  const recent = c.env.DB
    ? await queryRecentProviderRuns(c.env.DB, hasValidAdminToken(c.req.raw, c.env))
    : new Map<string, ProviderRunSummary>();
  const providers = declared.map((provider) => {
    const runs = recent.get(provider.name);
    if (!runs) {
      return {
        ...provider,
        status: "down" as const,
        lastSuccessAt: null,
        lastError: "최근 24시간 sync_runs 기록 없음",
        stale: true,
      };
    }
    const successRate = runs.total > 0 ? runs.success / runs.total : 0;
    return {
      ...provider,
      status: successRate >= 0.8 ? ("up" as const) : successRate > 0 ? ("degraded" as const) : ("down" as const),
      lastSuccessAt: runs.lastSuccessAt,
      lastError: runs.lastError,
      stale: runs.lastSuccessAt === null,
      last24h: {
        total: runs.total,
        success: runs.success,
        failed: runs.failed,
        timeout: runs.timeout,
      },
    };
  });
  // 어느 provider 목록에도 없는데 sync_runs에는 도는 것들(스크래퍼 등)도 같이 보여 준다.
  const declaredNames = new Set(declared.map((provider) => provider.name));
  for (const [name, runs] of recent) {
    if (declaredNames.has(name)) continue;
    const successRate = runs.total > 0 ? runs.success / runs.total : 0;
    providers.push({
      name,
      status: successRate >= 0.8 ? ("up" as const) : successRate > 0 ? ("degraded" as const) : ("down" as const),
      lastSuccessAt: runs.lastSuccessAt,
      lastError: runs.lastError,
      qualityScore: 0,
      stale: runs.lastSuccessAt === null,
      last24h: {
        total: runs.total,
        success: runs.success,
        failed: runs.failed,
        timeout: runs.timeout,
      },
    });
  }
  return c.json({ providers, generatedAt: new Date().toISOString() });
});

interface ProviderRunSummary {
  total: number;
  success: number;
  failed: number;
  timeout: number;
  lastSuccessAt: string | null;
  lastError: string | null;
}

/// sync_type은 discovery chunk가 `discover:<kind>:<provider>`, 스크래퍼가 `<name>-scrape`다.
/// 앞의 접두어를 떼서 provider.health()의 name과 맞춘다.
/// 이 쿼리는 started_at만 걸러서 sync_runs를 훑는다 — idx_sync_runs_type_started의
/// 선두 컬럼이 sync_type이라 인덱스를 못 쓴다. 보관이 30일이라 수천 행 수준이고
/// 관리·개발용으로만 부르는 엔드포인트여서 이 스캔을 그대로 둔다.
async function queryRecentProviderRuns(
  db: D1Database,
  includeMessages: boolean,
): Promise<Map<string, ProviderRunSummary>> {
  const result = await db
    .prepare(
      `SELECT sync_type,
              COUNT(*) AS total,
              SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
              SUM(CASE WHEN status = 'timeout' THEN 1 ELSE 0 END) AS timeout,
              MAX(CASE WHEN status = 'success' THEN started_at END) AS last_success_at,
              MAX(CASE WHEN status != 'success' THEN message END) AS last_message
         FROM sync_runs
        WHERE started_at > datetime('now', '-24 hours')
        GROUP BY sync_type`,
    )
    .all<{
      sync_type: string;
      total: number;
      success: number;
      failed: number;
      timeout: number;
      last_success_at: string | null;
      last_message: string | null;
    }>();
  const summaries = new Map<string, ProviderRunSummary>();
  for (const row of result.results ?? []) {
    const name = row.sync_type.startsWith("discover:")
      ? row.sync_type.split(":").slice(2).join(":") || row.sync_type
      : row.sync_type;
    if (!name) continue;
    summaries.set(name, {
      total: row.total ?? 0,
      success: row.success ?? 0,
      failed: row.failed ?? 0,
      timeout: row.timeout ?? 0,
      lastSuccessAt: row.last_success_at,
      lastError: includeMessages ? row.last_message : null,
    });
  }
  return summaries;
}

app.get("/discover/pipeline-stats", async (c) => {
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  // 앱 설정 화면이 토큰 없이 부르는 엔드포인트라 집계 자체는 열어 두되,
  // provider 예외 문자열이 담긴 sync_runs.message는 관리자 토큰이 있을 때만 준다.
  const stats = await queryPipelineStats(c.env.DB, {
    includeRunMessages: hasValidAdminToken(c.req.raw, c.env),
  });
  return c.json(stats);
});

app.post("/admin/sync-national-parking", async (c) => {
  const authResponse = authorizeAdminSync(c.req.raw, c.env);
  if (authResponse) return authResponse;
  if (!c.env.DB) {
    return c.json({ error: "d1_not_configured" }, 503);
  }
  if (!c.env.PUBLIC_DATA_SERVICE_KEY) {
    return c.json({ error: "public_data_key_not_configured" }, 503);
  }

  const query = syncNationalParkingSchema.parse(queryObject(c.req.raw.url));
  try {
    const result = await syncNationalParkingPage({
      db: c.env.DB,
      serviceKey: c.env.PUBLIC_DATA_SERVICE_KEY,
      baseUrl: c.env.NATIONAL_PARKING_DATA_BASE_URL ?? "https://api.data.go.kr",
      pageNo: query.pageNo,
      numOfRows: query.numOfRows,
      dryRun: query.dryRun ?? false,
    });
    return c.json({ ...result, generatedAt: new Date().toISOString() });
  } catch (error) {
    return c.json(syncErrorResponse(error), 502);
  }
});

app.get("/admin/sync-national-parking/preview", async (c) => {
  const authResponse = authorizeAdminSync(c.req.raw, c.env);
  if (authResponse) return authResponse;
  if (!c.env.PUBLIC_DATA_SERVICE_KEY) {
    return c.json({ error: "public_data_key_not_configured" }, 503);
  }

  const query = syncNationalParkingSchema.parse(queryObject(c.req.raw.url));
  try {
    const result = await syncNationalParkingPage({
      db: c.env.DB,
      serviceKey: c.env.PUBLIC_DATA_SERVICE_KEY,
      baseUrl: c.env.NATIONAL_PARKING_DATA_BASE_URL ?? "https://api.data.go.kr",
      pageNo: query.pageNo,
      numOfRows: Math.min(query.numOfRows, 20),
      dryRun: true,
    });
    return c.json({ ...result, generatedAt: new Date().toISOString() });
  } catch (error) {
    return c.json(syncErrorResponse(error), 502);
  }
});

app.post("/admin/sync-discovery", async (c) => {
  const authResponse = authorizeAdminSync(c.req.raw, c.env);
  if (authResponse) return authResponse;
  if (!c.env.DB) {
    return c.json({ error: "d1_not_configured" }, 503);
  }

  const query = discoverySyncSchema.parse(queryObject(c.req.raw.url));
  const backend = await loadBackend(c.env);
  try {
    if (query.chunkIndex !== undefined) {
      const chunkResult = await syncDiscoveryChunk(
        c.env.DB,
        backend,
        query.chunkIndex,
      );
      return c.json({
        result: [chunkResult],
        providers: [
          ...backend.festivalService.health(),
          ...backend.eventService.health(),
        ],
        generatedAt: new Date().toISOString(),
      });
    }
    const result = await syncDiscoveryCache(
      c.env.DB,
      backend,
      discoverySyncKinds(query.kinds),
    );
    return c.json({
      result,
      providers: [
        ...backend.festivalService.health(),
        ...backend.eventService.health(),
      ],
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return c.json(syncErrorResponse(error), 502);
  }
});

app.get("/agent-office/activity", async (c) => {
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const params = queryObject(c.req.raw.url);
  const limitRaw = Number(params.limit ?? 80);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(Math.trunc(limitRaw), 200))
    : 80;
  const since = typeof params.since === "string" ? params.since : null;
  try {
    const rows = since
      ? await c.env.DB.prepare(
          `SELECT id, ts, agent_id, action, target_kind, target_id, target_title, verdict, reason, payload_json
             FROM agent_activity
            WHERE ts > ?
            ORDER BY ts DESC
            LIMIT ?`,
        )
          .bind(since, limit)
          .all()
      : await c.env.DB.prepare(
          `SELECT id, ts, agent_id, action, target_kind, target_id, target_title, verdict, reason, payload_json
             FROM agent_activity
            ORDER BY ts DESC
            LIMIT ?`,
        )
          .bind(limit)
          .all();
    const items = (rows.results ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      let payload: unknown = null;
      if (typeof r.payload_json === "string" && r.payload_json) {
        try {
          payload = JSON.parse(r.payload_json);
        } catch {
          payload = null;
        }
      }
      return {
        id: r.id,
        ts: r.ts,
        agentId: r.agent_id,
        action: r.action,
        targetKind: r.target_kind,
        targetId: r.target_id,
        targetTitle: r.target_title,
        verdict: r.verdict,
        reason: r.reason,
        payload,
      };
    });
    return c.json({ items, generatedAt: new Date().toISOString() });
  } catch (error) {
    return c.json(syncErrorResponse(error), 502);
  }
});

app.post("/admin/sync-local-events", async (c) => {
  const authResponse = authorizeAdminSync(c.req.raw, c.env);
  if (authResponse) return authResponse;
  if (!c.env.DB) {
    return c.json({ error: "d1_not_configured" }, 503);
  }

  const query = localEventDiscoverySyncSchema.parse(queryObject(c.req.raw.url));
  const chunkCount = query.chunkCount ?? LOCAL_EVENT_CHUNK_COUNT;
  const chunkIndex =
    query.chunkIndex ?? currentLocalEventChunkIndex(new Date(), chunkCount);
  try {
    const result = await syncLocalEventDiscovery({
      db: c.env.DB,
      env: c.env,
      dryRun: query.dryRun ?? false,
      chunkIndex,
      chunkCount,
    });
    return c.json(result);
  } catch (error) {
    return c.json(syncErrorResponse(error), 502);
  }
});

app.post("/admin/sync-city-festivals", async (c) => {
  const authResponse = authorizeAdminSync(c.req.raw, c.env);
  if (authResponse) return authResponse;
  if (!c.env.DB) {
    return c.json({ error: "d1_not_configured" }, 503);
  }
  // 등록된 사이트 전체를 한 번에 처리하면 Cloudflare Workers의 invocation당
  // subrequest 한도를 넘어설 수 있어(사이트 fetch + Kakao geocoding 합산),
  // scheduled() 핸들러(syncCityFestivalsScheduled)와 동일하게 기본은 "오늘의
  // 청크"만 처리한다. chunkIndex를 명시하면 그 청크를 강제로 처리한다.
  const query = cityFestivalDiscoverySyncSchema.parse(queryObject(c.req.raw.url));
  const chunkIndex =
    query.chunkIndex ?? currentCityFestivalChunkIndex(new Date(), CITY_FESTIVAL_SITES.length);
  const sites = sitesForChunk(CITY_FESTIVAL_SITES, chunkIndex, CITY_FESTIVAL_CHUNK_SIZE);
  try {
    const result = await runCityFestivalDiscovery(c.env.DB, c.env, sites);
    return c.json(result);
  } catch (error) {
    return c.json(syncErrorResponse(error), 502);
  }
});

app.post("/admin/sync-akei-trade-expos", async (c) => {
  const authResponse = authorizeAdminSync(c.req.raw, c.env);
  if (authResponse) return authResponse;
  if (!c.env.DB) {
    return c.json({ error: "d1_not_configured" }, 503);
  }
  try {
    const result = await runAkeiTradeExpoDiscovery(c.env.DB, new Date());
    return c.json(result);
  } catch (error) {
    return c.json(syncErrorResponse(error), 502);
  }
});

app.post("/admin/backfill-fees", async (c) => {
  const authResponse = authorizeAdminSync(c.req.raw, c.env);
  if (authResponse) return authResponse;
  if (!c.env.DB) {
    return c.json({ error: "d1_not_configured" }, 503);
  }
  const query = feeBackfillSchema.parse(queryObject(c.req.raw.url));
  try {
    const result = await runFeeBackfill(c.env.DB, c.env, {
      maxItems: query.maxItems,
    });
    return c.json(result);
  } catch (error) {
    return c.json(syncErrorResponse(error), 502);
  }
});

const upcomingNotificationSchema = z.object({
  maxPushes: z.coerce.number().int().min(1).max(45).optional(),
  plan: z.coerce.boolean().optional(),
});

app.post("/admin/run-upcoming-notifications", async (c) => {
  const authResponse = authorizeAdminSync(c.req.raw, c.env);
  if (authResponse) return authResponse;
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const query = upcomingNotificationSchema.parse(queryObject(c.req.raw.url));
  try {
    const result = await runUpcomingNotifications(c.env, {
      plan: query.plan ?? true,
      maxPushes: query.maxPushes,
    });
    return c.json(result);
  } catch (error) {
    return c.json(syncErrorResponse(error), 502);
  }
});

app.post("/admin/backfill-images", async (c) => {
  const authResponse = authorizeAdminSync(c.req.raw, c.env);
  if (authResponse) return authResponse;
  if (!c.env.DB) {
    return c.json({ error: "d1_not_configured" }, 503);
  }
  const query = imageBackfillSchema.parse(queryObject(c.req.raw.url));
  try {
    const result = await runImageBackfill(c.env.DB, c.env, {
      maxItems: query.maxItems,
    });
    return c.json(result);
  } catch (error) {
    return c.json(syncErrorResponse(error), 502);
  }
});

app.post("/admin/backfill-geocodes", async (c) => {
  const authResponse = authorizeAdminSync(c.req.raw, c.env);
  if (authResponse) return authResponse;
  if (!c.env.DB) {
    return c.json({ error: "d1_not_configured" }, 503);
  }
  const query = geocodeBackfillSchema.parse(queryObject(c.req.raw.url));
  try {
    const result = await runGeocodeBackfill(c.env.DB, c.env, {
      maxLookups: query.maxLookups,
    });
    return c.json(result);
  } catch (error) {
    return c.json(syncErrorResponse(error), 502);
  }
});

app.post("/admin/run-head-review", async (c) => {
  const authResponse = authorizeAdminSync(c.req.raw, c.env);
  if (authResponse) return authResponse;
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  try {
    const result = await runHeadReview(c.env.DB, c.env);
    return c.json(result);
  } catch (error) {
    return c.json(syncErrorResponse(error), 502);
  }
});

app.post("/admin/run-image-enrichment", async (c) => {
  const authResponse = authorizeAdminSync(c.req.raw, c.env);
  if (authResponse) return authResponse;
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  try {
    const result = await runImageEnrichment(c.env.DB, c.env);
    return c.json(result);
  } catch (error) {
    return c.json(syncErrorResponse(error), 502);
  }
});

app.post("/admin/run-tagging", async (c) => {
  const authResponse = authorizeAdminSync(c.req.raw, c.env);
  if (authResponse) return authResponse;
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const url = new URL(c.req.raw.url);
  const maxRowsParam = url.searchParams.get("max_rows");
  const maxRows = maxRowsParam ? parseInt(maxRowsParam, 10) : undefined;
  try {
    const result = await runTagging(c.env, {
      source: "admin",
      mode: "incremental",
      maxRows: Number.isFinite(maxRows) ? (maxRows as number) : undefined,
    });
    return c.json(result);
  } catch (error) {
    return c.json(syncErrorResponse(error), 502);
  }
});

app.post("/admin/run-tagging-backfill", async (c) => {
  const authResponse = authorizeAdminSync(c.req.raw, c.env);
  if (authResponse) return authResponse;
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const url = new URL(c.req.raw.url);
  const maxRowsParam = url.searchParams.get("max_rows");
  const maxRows = maxRowsParam ? parseInt(maxRowsParam, 10) : 500;
  try {
    const result = await runTagging(c.env, {
      source: "backfill",
      mode: "backfill",
      maxRows,
    });
    return c.json(result);
  } catch (error) {
    return c.json(syncErrorResponse(error), 502);
  }
});

app.notFound((c) => c.json({ error: "not_found" }, 404));

export default {
  fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Response | Promise<Response> {
    return app.fetch(request, env, ctx);
  },
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    if (!env.DB) return;
    if (controller.cron === "*/3 * * * *") {
      ctx.waitUntil(syncRealtimeParkingScheduled(env));
      // 다가오는 행사 알림은 전용 cron slot이 없다(계정 한도 5개를 이미 다 쓴다).
      // 실시간 주차 동기화는 외부 fetch를 한두 건만 쓰므로 같은 invocation의
      // subrequest 50건 예산에 여유가 있다. 30분마다 발송하고, 정각에는 계획도 함께 돈다.
      const scheduledAt = new Date(controller.scheduledTime);
      if (scheduledAt.getUTCMinutes() % 30 === 0) {
        ctx.waitUntil(
          runUpcomingNotificationsScheduled(env, {
            plan: scheduledAt.getUTCMinutes() === 0,
          }),
        );
      }
      // 하루 1회짜리 스크래퍼 둘은 예전에 "15 * * * *"에 얹혀 있었는데, 그 invocation은
      // 매시간 로컬 이벤트 sync(Naver/Kakao 호출 다수)와 subrequest 50건 예산을 나눠
      // 쓴다. AKEI만 해도 3개월 × 최대 10페이지라 예산을 넘기면 첫 fetch부터 실패하고
      // 아무것도 저장하지 못한다(실측: 8/24~8/29 6일 연속 scraped_at 무변화).
      // 이 invocation은 실시간 주차 sync 한두 건만 쓰므로 여유가 있다. 21분은 알림이
      // 도는 0/30분 슬롯과도 겹치지 않는다.
      if (scheduledAt.getUTCMinutes() === 21) {
        if (scheduledAt.getUTCHours() === 4) {
          ctx.waitUntil(syncCityFestivalsScheduled(env, scheduledAt));
        }
        if (scheduledAt.getUTCHours() === 5) {
          ctx.waitUntil(syncAkeiTradeExposScheduled(env, scheduledAt));
        }
      }
      return;
    }
    if (controller.cron === "*/9 * * * *") {
      const scheduledAt = new Date(controller.scheduledTime);
      ctx.waitUntil(
        syncDiscoveryChunkScheduled(
          env,
          currentDiscoveryChunkIndex(scheduledAt),
        ),
      );
      return;
    }
    if (controller.cron === "15 * * * *") {
      const scheduledAt = new Date(controller.scheduledTime);
      ctx.waitUntil(
        syncLocalEventsScheduled(
          env,
          currentLocalEventChunkIndex(scheduledAt, LOCAL_EVENT_CHUNK_COUNT),
        ),
      );
      // sync_runs 보관 정리도 같은 이유로 UTC 6시 가드를 얹어 하루 1회만 돈다.
      // 하루 269행씩 늘어나므로 이 주기로 충분하다.
      if (scheduledAt.getUTCHours() === 6 && env.DB) {
        ctx.waitUntil(
          pruneOldSyncRuns(env.DB).catch((error) => {
            console.error("pruneOldSyncRuns failed", error);
            return 0;
          }),
        );
      }
      // analytics_daily도 같은 하루 1회 슬롯에서 보관 기간(180일)만 남긴다.
      if (scheduledAt.getUTCHours() === 6 && env.DB) {
        ctx.waitUntil(
          pruneOldAnalytics(env.DB).catch((error) => {
            console.error("pruneOldAnalytics failed", error);
            return 0;
          }),
        );
      }
      return;
    }
    if (controller.cron === "30 */3 * * *") {
      ctx.waitUntil(runAgentOfficeScheduled(env));
      return;
    }
    if (controller.cron === "*/5 * * * *") {
      // 태깅과 backfill은 예전에 한 invocation에서 같이 돌았다. invocation당
      // CPU 10ms·subrequest 50건을 둘이 나눠 쓰는 구조라, 앞서 도는 태깅이
      // 예산을 대부분 먹고 backfill은 회차당 4건 남짓만 처리하다 죽었다
      // (실측 2026-08-18: 지오코딩 88건/일, 사진 90건/일 — 설계치의 12~15%).
      // 지금은 한 invocation에 한 작업만 둔다. 대신 cron 주기를 5분으로 당겨
      // 각 작업이 예전과 같은 하루 72회를 유지하되, 매 회차 CPU·subrequest
      // 예산을 통째로 쓴다. cron trigger 개수는 그대로 5개다.
      const scheduledAt = new Date(controller.scheduledTime);
      const slot = Math.floor(scheduledAt.getUTCMinutes() / 5) % 4;
      if (slot === 0) {
        ctx.waitUntil(runTaggingScheduled(env));
      } else if (slot === 1) {
        ctx.waitUntil(runFeeBackfillScheduled(env));
      } else if (slot === 2) {
        ctx.waitUntil(runGeocodeBackfillScheduled(env));
      } else {
        ctx.waitUntil(runImageBackfillScheduled(env));
      }
      return;
    }
  },
};

// Cron 작업 실패를 운영자에게 알린다. webhook URL이 없으면 조용히 통과하므로
// secret 미설정 환경(로컬/테스트)에서도 안전하다. 알림 자체 실패도 sync를 죽이지 않는다.
// URL에 "slack"이 들어가면 Slack(`text`), 아니면 Discord(`content`) 형식으로 보낸다.
async function notifyOpsFailure(
  env: Env,
  label: string,
  error: unknown,
): Promise<void> {
  const url = env.OPS_ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    const message = error instanceof Error ? error.message : String(error);
    const payload = `🚨 [이벤트다 cron 실패] ${label}\n${message}`.slice(0, 1900);
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        url.includes("slack") ? { text: payload } : { content: payload },
      ),
    });
  } catch (notifyError) {
    console.error("ops alert webhook failed", notifyError);
  }
}

async function runTaggingScheduled(env: Env): Promise<void> {
  try {
    const result = await runTagging(env, {
      source: "cron",
      mode: "incremental",
    });
    if (result.processed > 0) {
      console.log("tagging cron done", JSON.stringify(result));
    }
  } catch (error) {
    console.error("tagging cron failed", error);
    await notifyOpsFailure(env, "tagging cron", error);
  }
}

async function runFeeBackfillScheduled(env: Env): Promise<void> {
  try {
    const result = await runFeeBackfill(env.DB!, env);
    // scanned=0도 남긴다. 로그가 아예 없으면 "처리할 행이 없음"과
    // "invocation이 죽어서 못 돌았음"을 구분할 수 없다.
    console.log("fee backfill done", JSON.stringify(result));
  } catch (error) {
    console.error("fee backfill failed", error);
    await notifyOpsFailure(env, "fee backfill", error);
  }
}

async function runImageBackfillScheduled(env: Env): Promise<void> {
  try {
    const result = await runImageBackfill(env.DB!, env);
    if (result.scanned > 0) {
      console.log("image backfill done", JSON.stringify(result));
    }
  } catch (error) {
    console.error("image backfill failed", error);
    await notifyOpsFailure(env, "image backfill", error);
  }
}

async function runGeocodeBackfillScheduled(env: Env): Promise<void> {
  try {
    const result = await runGeocodeBackfill(env.DB!, env);
    if (result.scanned + result.discovery.scanned > 0) {
      console.log("geocode backfill done", JSON.stringify(result));
    }
  } catch (error) {
    console.error("geocode backfill failed", error);
    await notifyOpsFailure(env, "geocode backfill", error);
  }
}

async function runAgentOfficeScheduled(env: Env): Promise<void> {
  await Promise.all([
    runHeadReviewScheduled(env),
    runImageEnrichmentScheduled(env),
  ]);
}

async function runHeadReviewScheduled(env: Env): Promise<void> {
  try {
    await runHeadReview(env.DB!, env);
  } catch (error) {
    console.error("head review scheduled failed", error);
    await notifyOpsFailure(env, "head review", error);
  }
}

async function runImageEnrichmentScheduled(env: Env): Promise<void> {
  try {
    await runImageEnrichment(env.DB!, env);
  } catch (error) {
    console.error("image enrichment scheduled failed", error);
    await notifyOpsFailure(env, "image enrichment", error);
  }
}

/**
 * 계획(D1만) + 발송(APNs)을 한 번에 돈다. APNs 설정이 없으면 계획만 하고 조용히 넘어간다 —
 * 대기 행은 남아 있으므로 설정을 채운 뒤 다음 회차에 그대로 나간다.
 */
async function runUpcomingNotifications(
  env: Env,
  options: { plan: boolean; maxPushes?: number },
): Promise<Record<string, unknown>> {
  const db = env.DB!;
  const planned = options.plan
    ? await planUpcomingNotifications(db)
    : { planned: 0, events: 0, devices: 0 };
  const config = apnsConfigFromEnv(env);
  if (!config) {
    return { planned, dispatched: null, reason: "apns_not_configured" };
  }
  const maxPushes =
    options.maxPushes ??
    Number(env.UPCOMING_NOTIFICATION_MAX_PUSHES ?? "40") ??
    40;
  const dispatched = await dispatchPendingNotifications(
    db,
    createApnsSender(config),
    { maxPushes },
  );
  return { planned, dispatched };
}

async function runUpcomingNotificationsScheduled(
  env: Env,
  options: { plan: boolean },
): Promise<void> {
  try {
    await runUpcomingNotifications(env, options);
  } catch (error) {
    console.error("upcoming notifications failed", error);
    await notifyOpsFailure(env, "upcoming notifications", error);
  }
}

async function syncRealtimeParkingScheduled(env: Env): Promise<void> {
  try {
    const provider = await loadRealtimeProvider(env);
    await syncRealtimeParkingCache(env.DB!, provider);
  } catch (error) {
    console.error("realtime parking sync failed", error);
    await notifyOpsFailure(env, "realtime parking sync", error);
  }
}

async function loadRealtimeProvider(
  env: Env,
): Promise<BackendRuntime["realtimeParkingProvider"]> {
  syncProcessEnv(env);
  realtimeProviderPromise ??= (async () => {
    const { createRealtimeParkingProvider } =
      await import("../../backend/src/providers/createRealtimeProviders.js");
    return createRealtimeParkingProvider();
  })();
  return realtimeProviderPromise;
}

async function loadDiscoveryRuntime(env: Env): Promise<{
  festivalService: BackendRuntime["festivalService"];
  eventService: BackendRuntime["eventService"];
}> {
  syncProcessEnv(env);
  discoveryRuntimePromise ??= (async () => {
    const [
      { createFestivalService },
      { createEventService },
      { setGeocodeStore },
    ] = await Promise.all([
      import("../../backend/src/features/discover/festivals/festivalService.js"),
      import("../../backend/src/features/discover/events/eventService.js"),
      import("../../backend/src/features/discover/events/eventProviderUtils.js"),
    ]);
    if (env.DB) setGeocodeStore(createD1GeocodeStore(env.DB));
    else setGeocodeStore(null);
    return {
      festivalService: createFestivalService(
        env.DB
          ? [new CityScrapedFestivalProvider(env.DB), new AkeiTradeExpoFestivalProvider(env.DB)]
          : [],
      ),
      eventService: createEventService(),
    };
  })();
  return discoveryRuntimePromise;
}

async function syncDiscoveryChunkScheduled(
  env: Env,
  chunkIndex: number,
): Promise<void> {
  try {
    if (env.DB) {
      const reaped = await reapStaleSyncRuns(env.DB).catch((error) => {
        console.error("reapStaleSyncRuns failed", error);
        return 0;
      });
      // CPU 한도를 넘겨 isolate가 통째로 죽으면 예외가 잡히지 않아 실패 알림이
      // 나가지 않는다. 시작 기록만 남고 끝나지 않은 sync run이 그 유일한 흔적이라
      // 여기서 알려 조용한 죽음을 관측 가능하게 만든다.
      if (reaped > 0) {
        await notifyOpsFailure(
          env,
          "sync run 무응답",
          new Error(
            `${reaped}건이 종료 기록 없이 timeout 처리됨 (CPU/시간 한도 초과 의심)`,
          ),
        );
      }
    }
    const runtime = await loadDiscoveryRuntime(env);
    await syncDiscoveryChunk(env.DB!, runtime, chunkIndex);
  } catch (error) {
    console.error(
      `discovery chunk sync failed (chunk ${chunkIndex}/${DISCOVERY_PROVIDER_CHUNK_COUNT})`,
      error,
    );
    await notifyOpsFailure(
      env,
      `discovery chunk ${chunkIndex}/${DISCOVERY_PROVIDER_CHUNK_COUNT}`,
      error,
    );
  }
}

async function syncLocalEventsScheduled(
  env: Env,
  chunkIndex: number,
): Promise<void> {
  try {
    await syncLocalEventDiscovery({
      db: env.DB!,
      env,
      chunkIndex,
      chunkCount: LOCAL_EVENT_CHUNK_COUNT,
    });
  } catch (error) {
    console.error("local event discovery sync failed", error);
    await notifyOpsFailure(env, "local event discovery sync", error);
  }
}

/// 스크래퍼 한 회차를 sync_runs에 한 행으로 남긴다.
/// discovery chunk와 달리 이 둘은 아무 흔적도 남기지 않아서, 앱에 새 행사가 없을 때
/// "cron이 안 돌았다"인지 "원본이 비었다"인지 "fetch가 실패했다"인지 대시보드로
/// 구분할 수 없었다. notifyOpsFailure는 webhook이 설정돼 있어야만 무언가를 남긴다.
/// 실행 중 상태('running')는 쓰지 않는다 — 결과 한 행이면 충분하고,
/// reapStaleSyncRuns가 잡을 미완료 행도 만들지 않는다.
async function recordScraperRun(
  db: D1Database | undefined,
  syncType: string,
  startedAt: string,
  status: "success" | "failed",
  counts: { fetched: number; upserted: number },
  message: string | null,
): Promise<void> {
  if (!db) return;
  try {
    await db
      .prepare(
        `INSERT INTO sync_runs (id, sync_type, started_at, finished_at, status, fetched, upserted, skipped, pruned, message)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
      )
      .bind(
        `${syncType}:${startedAt}`,
        syncType,
        startedAt,
        new Date().toISOString(),
        status,
        counts.fetched,
        counts.upserted,
        message,
      )
      .run();
  } catch (error) {
    // 기록 실패가 스크래핑 결과를 되돌리지는 않는다.
    console.error(`sync_runs record failed for ${syncType}`, error);
  }
}

async function syncCityFestivalsScheduled(env: Env, scheduledAt: Date): Promise<void> {
  const startedAt = new Date().toISOString();
  try {
    const chunkIndex = currentCityFestivalChunkIndex(scheduledAt, CITY_FESTIVAL_SITES.length);
    const sites = sitesForChunk(CITY_FESTIVAL_SITES, chunkIndex, CITY_FESTIVAL_CHUNK_SIZE);
    const result = await runCityFestivalDiscovery(env.DB!, env, sites);
    if (result.failedSites.length > 0) {
      console.warn(`city festival discovery failedSites=${result.failedSites.join(",")}`);
    }
    await recordScraperRun(
      env.DB,
      "city-festival-scrape",
      startedAt,
      "success",
      { fetched: result.processed, upserted: result.published },
      `chunk=${chunkIndex} sites=${sites.length}` +
        (result.failedSites.length > 0 ? ` failedSites=${result.failedSites.join(",")}` : ""),
    );
  } catch (error) {
    console.error("city festival discovery sync failed", error);
    await recordScraperRun(env.DB, "city-festival-scrape", startedAt, "failed", { fetched: 0, upserted: 0 }, String(error));
    await notifyOpsFailure(env, "city festival discovery sync", error);
  }
}

async function syncAkeiTradeExposScheduled(env: Env, scheduledAt: Date): Promise<void> {
  const startedAt = new Date().toISOString();
  try {
    const result = await runAkeiTradeExpoDiscovery(env.DB!, scheduledAt);
    if (result.failedMonths.length > 0 || result.unmappedVenues > 0) {
      console.warn(
        `akei trade expo discovery failedMonths=${result.failedMonths.join(",")} unmappedVenues=${result.unmappedVenues}`,
      );
    }
    await recordScraperRun(
      env.DB,
      "akei-trade-expo-scrape",
      startedAt,
      result.failedMonths.length > 0 || result.failedBatches > 0 ? "failed" : "success",
      { fetched: result.processed, upserted: result.published },
      `failedMonths=${result.failedMonths.join(",")} failedBatches=${result.failedBatches} unmappedVenues=${result.unmappedVenues}`,
    );
  } catch (error) {
    console.error("akei trade expo discovery sync failed", error);
    await recordScraperRun(env.DB, "akei-trade-expo-scrape", startedAt, "failed", { fetched: 0, upserted: 0 }, String(error));
    await notifyOpsFailure(env, "akei trade expo discovery sync", error);
  }
}

function currentLocalEventChunkIndex(now: Date, chunkCount: number): number {
  if (chunkCount <= 1) return 0;
  const slot = Math.floor(now.getTime() / (3 * 60 * 60 * 1000));
  return ((slot % chunkCount) + chunkCount) % chunkCount;
}

function queryObject(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams.entries());
}

function discoveryClusterTypes(
  value: string | undefined,
): Array<"festival" | "event"> {
  const allowed = new Set(["festival", "event"]);
  const types = (value ?? "festival,event")
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is "festival" | "event" => allowed.has(item));
  return types.length > 0 ? types : ["festival", "event"];
}

function discoverySyncKinds(
  value: string | undefined,
): Array<"festivals" | "events"> {
  const allowed = new Set(["festivals", "events"]);
  const kinds = (value ?? "festivals,events")
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is "festivals" | "events" => allowed.has(item));
  return kinds.length > 0 ? kinds : ["festivals", "events"];
}

function authorizeAdminSync(request: Request, env: Env): Response | null {
  if (!env.SYNC_ADMIN_TOKEN) {
    return Response.json(
      { error: "sync_admin_token_not_configured" },
      { status: 503 },
    );
  }
  if (!hasValidAdminToken(request, env)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  return null;
}

function hasValidAdminToken(request: Request, env: Env): boolean {
  if (!env.SYNC_ADMIN_TOKEN) return false;
  const token = request.headers
    .get("Authorization")
    ?.replace(/^Bearer\s+/i, "");
  return Boolean(token && timingSafeStringEqual(token, env.SYNC_ADMIN_TOKEN));
}

function syncErrorResponse(error: unknown): { error: string; message: string } {
  return {
    error: "sync_failed",
    message: error instanceof Error ? error.message : "Unknown sync error",
  };
}

async function loadBackend(env: Env): Promise<BackendRuntime> {
  syncProcessEnv(env);
  backendRuntime ??= importBackend(env);
  return backendRuntime;
}

async function importBackend(env: Env): Promise<BackendRuntime> {
  const [
    { searchDestination },
    { createCompositeParkingProvider, createRealtimeParkingProvider },
    { createFestivalService },
    { createEventService },
    { SearchHistoryService },
    { searchHistoryRepository },
    { setGeocodeStore },
  ] = await Promise.all([
    import("../../backend/src/services/destinationSearch.js"),
    import("../../backend/src/providers/createProviders.js"),
    import("../../backend/src/features/discover/festivals/festivalService.js"),
    import("../../backend/src/features/discover/events/eventService.js"),
    import("../../backend/src/features/analytics/searchHistoryService.js"),
    import("../../backend/src/features/analytics/SearchHistoryRepository.js"),
    import("../../backend/src/features/discover/events/eventProviderUtils.js"),
  ]);

  if (env.DB) {
    setGeocodeStore(createD1GeocodeStore(env.DB));
  } else {
    setGeocodeStore(null);
  }

  return {
    searchDestination,
    parkingProvider: createCompositeParkingProvider({ d1: env.DB }),
    realtimeParkingProvider: createRealtimeParkingProvider(),
    festivalService: createFestivalService(
      env.DB
        ? [new CityScrapedFestivalProvider(env.DB), new AkeiTradeExpoFestivalProvider(env.DB)]
        : [],
    ),
    eventService: createEventService(),
    searchHistoryService: new SearchHistoryService(searchHistoryRepository),
  };
}

// backend/src의 모듈들은 config/env.ts(모듈 로드 시점 zod 파싱)와 일부 process.env 직접
// 참조로 설정을 읽으므로, Worker 바인딩을 process.env로 옮겨줘야 한다. 다만 전부 복사하면
// SYNC_ADMIN_TOKEN·MERCHANT_SESSION_SECRET처럼 backend가 쓰지도 않는 시크릿까지 전역에
// 올라간다. backend가 실제로 읽는 키만 옮긴다 — backend/src/config/env.ts의 envSchema나
// process.env 직접 참조를 추가할 때 이 목록도 같이 갱신할 것.
const BACKEND_ENV_KEYS = [
  // backend/src/config/env.ts envSchema
  "NODE_ENV",
  "PORT",
  "HOST",
  "LOG_LEVEL",
  "PARKING_PROVIDER_MODE",
  "DEFAULT_SEARCH_RADIUS_METERS",
  "DEFAULT_DISCOVER_RADIUS_METERS",
  "STALE_THRESHOLD_SECONDS",
  "CACHE_TTL_SECONDS",
  "DISCOVER_CACHE_TTL_SECONDS",
  "FESTIVAL_PROVIDER_ENABLED",
  "EVENT_PROVIDER_ENABLED",
  "KAKAO_REST_API_KEY",
  "KAKAO_LOCAL_BASE_URL",
  "SEOUL_OPEN_DATA_KEY",
  "SEOUL_OPEN_DATA_BASE_URL",
  "SEOUL_SEONGDONG_IOT_KEY",
  "SEOUL_HANGANG_PARKING_KEY",
  "PUBLIC_DATA_SERVICE_KEY",
  "PUBLIC_DATA_ENV",
  "PUBLIC_DATA_BASE_URL",
  "CULTURE_PORTAL_API_KEY",
  "KOPIS_API_KEY",
  "KOPIS_BASE_URL",
  "KCISA_428_API_KEY",
  "KCISA_196_API_KEY",
  "KCISA_BASE_URL",
  // provider 튜닝값 (process.env 직접 참조)
  "CULTURE_PORTAL_MAX_PAGES",
  "EVENT_GEOCODE_MISS_BUDGET",
  "KCISA_MAX_PAGES",
  "KOPIS_MAX_PAGES",
  "KOPIS_DETAIL_MAX_ITEMS",
  "KOPIS_PAGE_CYCLES",
  "NATIONAL_CULTURE_MAX_PAGES",
  "SEOUL_CULTURE_MAX_PAGES",
  "TOUR_AREA_DATE_RESOLVE_MAX_ITEMS",
  "TOUR_AREA_FESTIVAL_MAX_PAGES",
  "TOUR_ENRICH_MAX_ITEMS",
  "TOUR_FESTIVAL_MAX_PAGES",
  // worker-backend/src/discoveryCache.ts positiveIntegerFromEnv
  "DISCOVERY_SYNC_CONCURRENCY",
  "DISCOVERY_SYNC_FETCH_TIMEOUT_MS",
] as const;

function syncProcessEnv(env: Env): void {
  const source = env as unknown as Record<string, unknown>;
  for (const key of BACKEND_ENV_KEYS) {
    const value = source[key];
    if (typeof value === "string") {
      process.env[key] = value;
    }
  }
}
