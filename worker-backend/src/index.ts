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
  queryFestivalsFromCache,
  queryPerformancesFromCache,
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
import { runGeocodeBackfill } from "./geocodeBackfill.js";
import { runHeadReview } from "./agents/headAgent.js";
import { runImageEnrichment } from "./agents/imageAgent.js";
import { runTagging } from "./llmTagging.js";
import { createMerchantApp } from "./merchant/routes.js";
import { createLegalApp } from "./legal/routes.js";
import {
  queryRealtimeParkingCache,
  queryRealtimeParkingClusters,
  syncRealtimeParkingCache,
} from "./realtimeParkingCache.js";
import { queryStaticParkingCache } from "./staticParkingCache.js";
import { createD1GeocodeStore } from "./geocodeStore.js";
import { queryPipelineStats } from "./pipelineStats.js";

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

app.post("/api/local-events/report", async (c) => {
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const item = await createLocalEventReport(
    c.env.DB,
    localEventReportSchema.parse(await c.req.json()),
  );
  return c.json({ item, generatedAt: new Date().toISOString() }, 202);
});

app.post("/api/admin/local-events", async (c) => {
  const authResponse = authorizeAdminSync(c.req.raw, c.env);
  if (authResponse) return authResponse;
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const item = await createAdminLocalEvent(
    c.env.DB,
    adminLocalEventSchema.parse(await c.req.json()),
  );
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
  return c.json({
    providers: [
      ...backend.festivalService.health(),
      ...backend.eventService.health(),
    ],
    generatedAt: new Date().toISOString(),
  });
});

app.get("/discover/pipeline-stats", async (c) => {
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const stats = await queryPipelineStats(c.env.DB);
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
      // 전용 cron 슬롯을 새로 쓰지 않고, 이 시간당 트리거에 UTC 4시 가드를 얹어
      // 하루 1회 도시별 축제 스크래핑을 실행한다 (계정의 5개 cron trigger 한도 때문).
      if (scheduledAt.getUTCHours() === 4) {
        ctx.waitUntil(syncCityFestivalsScheduled(env, scheduledAt));
      }
      // 같은 이유로 AKEI 무역박람회 스크래핑은 UTC 5시 가드로 하루 1회 실행한다.
      if (scheduledAt.getUTCHours() === 5) {
        ctx.waitUntil(syncAkeiTradeExposScheduled(env, scheduledAt));
      }
      return;
    }
    if (controller.cron === "30 */3 * * *") {
      ctx.waitUntil(runAgentOfficeScheduled(env));
      return;
    }
    if (controller.cron === "*/20 * * * *") {
      ctx.waitUntil(runTaggingScheduled(env));
      // 요금 backfill은 항목별 detail 호출이라 한 번에 다 못 돈다. invocation당
      // subrequest 예산이 50이므로, 외부 호출이 많은 로컬 이벤트/스크래핑 cron
      // 대신 호출이 가벼운 태깅 cron에 얹어 조금씩 나눠 돈다.
      // 요금 backfill(30건)과 지오코딩 backfill(25건)을 한 invocation에서 함께
      // 돌리면 50건 예산을 넘긴다. 새 cron 슬롯을 쓸 수 없어(계정당 5개 한도)
      // UTC 시(hour) 홀짝으로 번갈아 실행한다 — 각각 하루 36회씩 돈다.
      const scheduledAt = new Date(controller.scheduledTime);
      if (scheduledAt.getUTCHours() % 2 === 0) {
        ctx.waitUntil(runFeeBackfillScheduled(env));
      } else {
        ctx.waitUntil(runGeocodeBackfillScheduled(env));
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
    if (result.scanned > 0) {
      console.log("fee backfill done", JSON.stringify(result));
    }
  } catch (error) {
    console.error("fee backfill failed", error);
    await notifyOpsFailure(env, "fee backfill", error);
  }
}

async function runGeocodeBackfillScheduled(env: Env): Promise<void> {
  try {
    const result = await runGeocodeBackfill(env.DB!, env);
    if (result.scanned > 0) {
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
      await reapStaleSyncRuns(env.DB).catch((error) =>
        console.error("reapStaleSyncRuns failed", error),
      );
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

async function syncCityFestivalsScheduled(env: Env, scheduledAt: Date): Promise<void> {
  try {
    const chunkIndex = currentCityFestivalChunkIndex(scheduledAt, CITY_FESTIVAL_SITES.length);
    const sites = sitesForChunk(CITY_FESTIVAL_SITES, chunkIndex, CITY_FESTIVAL_CHUNK_SIZE);
    const result = await runCityFestivalDiscovery(env.DB!, env, sites);
    if (result.failedSites.length > 0) {
      console.warn(`city festival discovery failedSites=${result.failedSites.join(",")}`);
    }
  } catch (error) {
    console.error("city festival discovery sync failed", error);
    await notifyOpsFailure(env, "city festival discovery sync", error);
  }
}

async function syncAkeiTradeExposScheduled(env: Env, scheduledAt: Date): Promise<void> {
  try {
    const result = await runAkeiTradeExpoDiscovery(env.DB!, scheduledAt);
    if (result.failedMonths.length > 0 || result.unmappedVenues > 0) {
      console.warn(
        `akei trade expo discovery failedMonths=${result.failedMonths.join(",")} unmappedVenues=${result.unmappedVenues}`,
      );
    }
  } catch (error) {
    console.error("akei trade expo discovery sync failed", error);
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

  const token = request.headers
    .get("Authorization")
    ?.replace(/^Bearer\s+/i, "");
  if (!token || !timingSafeStringEqual(token, env.SYNC_ADMIN_TOKEN)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  return null;
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
