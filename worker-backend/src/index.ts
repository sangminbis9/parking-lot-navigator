import { Hono } from "hono";
import { cors } from "hono/cors";
import { z, ZodError } from "zod";
import type { MapItem } from "@parking/shared-types";
import { syncNationalParkingPage } from "./nationalParkingSync.js";
import {
  queryDiscoveryClusters,
  queryFestivalsFromCache,
  syncDiscoveryCache
} from "./discoveryCache.js";
import {
  createAdminLocalEvent,
  createLocalEventReport,
  getLocalEvent,
  localEventMapItem,
  patchLocalEventStatus,
  queryLocalEvents,
  updateAdminLocalEvent
} from "./localEvents.js";
import { syncLocalEventDiscovery } from "./localEventDiscovery.js";
import {
  queryRealtimeParkingCache,
  queryRealtimeParkingClusters,
  syncRealtimeParkingCache
} from "./realtimeParkingCache.js";
import { queryStaticParkingCache } from "./staticParkingCache.js";

type Env = {
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
  FESTIVAL_PROVIDER_ENABLED: string;
  EVENT_PROVIDER_ENABLED: string;
  LOCAL_EVENT_PROVIDER_ENABLED: string;
  LOCAL_EVENT_AUTO_APPROVE_MIN_SCORE: string;
  LOCAL_EVENT_SEARCH_MAX_QUERIES: string;
  KAKAO_CATEGORY_RADIUS_METERS: string;
  KAKAO_CATEGORY_MAX_PAGES: string;
  NAVER_CLIENT_ID?: string;
  NAVER_CLIENT_SECRET?: string;
  NAVER_SEARCH_BASE_URL: string;
  NAVER_PLACE_BASE_URL: string;
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
  KCISA_428_API_KEY?: string;
  KCISA_196_API_KEY?: string;
  KCISA_BASE_URL: string;
  NATIONAL_PARKING_DATA_BASE_URL?: string;
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
  realtimeParkingProvider: ReturnType<BackendModules["createRealtimeParkingProvider"]>;
  festivalService: ReturnType<BackendModules["createFestivalService"]>;
  eventService: ReturnType<BackendModules["createEventService"]>;
  searchHistoryService: InstanceType<BackendModules["SearchHistoryService"]>;
};

const app = new Hono<{ Bindings: Env }>();
let backendRuntime: Promise<BackendRuntime> | null = null;

const optionalBoolean = z
  .enum(["true", "false"])
  .transform((value) => value === "true")
  .optional();

const searchQuerySchema = z.object({
  q: z.string().min(1)
});

const parkingNearbySchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  radiusMeters: z.coerce.number().optional(),
  clusterMeters: z.coerce.number().min(250).max(50000).optional(),
  preferPublic: optionalBoolean,
  evOnly: optionalBoolean,
  accessibleOnly: optionalBoolean,
  bestWalkingDistanceBias: optionalBoolean
});

const discoverQuerySchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  radiusMeters: z.coerce.number().optional(),
  ongoingOnly: optionalBoolean,
  upcomingWithinDays: z.coerce.number().min(0).max(365).optional(),
  freeOnly: optionalBoolean
});

const localEventQuerySchema = discoverQuerySchema.extend({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

const mapItemsQuerySchema = localEventQuerySchema.extend({
  type: z.enum(["festival", "event", "all"]).default("all")
});

const eventSourceSchema = z.enum(["instagram", "naver_place", "owner_submitted", "admin_manual", "user_report", "official_site", "other"]);
const eventStatusSchema = z.enum(["pending", "approved", "rejected", "expired"]);
const eventTypeSchema = z.enum(["discount", "freebie", "review_event", "popup", "limited_menu", "opening_event", "etc"]);

const localEventReportSchema = z.object({
  sourceUrl: z.string().url().nullable().optional(),
  captionText: z.string().max(5000).nullable().optional(),
  storeName: z.string().max(200).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  note: z.string().max(1000).nullable().optional()
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
  priorityScore: z.number().int().min(0).max(10000).optional()
});

const adminLocalEventPatchSchema = adminLocalEventSchema.partial().extend({
  source: eventSourceSchema.optional()
});

const localEventStatusPatchSchema = z.object({
  status: eventStatusSchema,
  rejectionReason: z.string().max(1000).nullable().optional()
});

const discoveryClusterSchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  radiusMeters: z.coerce.number().optional(),
  clusterMeters: z.coerce.number().min(250).max(100000).optional(),
  types: z.string().optional()
});

const discoverySyncSchema = z.object({
  kinds: z.string().optional()
});

const localEventDiscoverySyncSchema = z.object({
  dryRun: optionalBoolean
});

const syncNationalParkingSchema = z.object({
  pageNo: z.coerce.number().int().min(1).default(1),
  numOfRows: z.coerce.number().int().min(1).max(1000).default(500),
  dryRun: optionalBoolean
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
  "other"
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
  provider: z.string().max(80).nullable().optional()
});

const listQuerySchema = z.object({
  deviceId: z.string().min(8).max(128).optional()
});

app.use("*", cors());

app.onError((error, c) => {
  if (error instanceof ZodError) {
    return c.json({ error: "bad_request", issues: error.issues }, 400);
  }
  console.error(error);
  return c.json({ error: "internal_error" }, 500);
});

app.get("/", (c) => c.json({ status: "ok", generatedAt: new Date().toISOString() }));

app.get("/health", (c) => c.json({ status: "ok", generatedAt: new Date().toISOString() }));

app.get("/search/destination", async (c) => {
  const query = searchQuerySchema.parse({ q: c.req.query("q") });
  const backend = await loadBackend(c.env);
  const items = await backend.searchDestination(query.q);
  return c.json({ items });
});

app.get("/parking/nearby", async (c) => {
  const query = parkingNearbySchema.parse(queryObject(c.req.raw.url));
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const radiusMeters = query.radiusMeters ?? Number(c.env.DEFAULT_SEARCH_RADIUS_METERS);
  const options = {
    radiusMeters,
    preferPublic: query.preferPublic,
    evOnly: query.evOnly,
    accessibleOnly: query.accessibleOnly,
    bestWalkingDistanceBias: query.bestWalkingDistanceBias
  };
  const items = await queryStaticParkingCache(c.env.DB, query.lat, query.lng, options);
  return c.json({
    destination: { lat: query.lat, lng: query.lng, radiusMeters },
    items,
    generatedAt: new Date().toISOString()
  });
});

app.get("/parking/providers/health", async (c) => {
  const backend = await loadBackend(c.env);
  return c.json({
    providers: backend.parkingProvider.health(),
    generatedAt: new Date().toISOString()
  });
});

app.get("/parking/realtime", async (c) => {
  const query = parkingNearbySchema.parse(queryObject(c.req.raw.url));
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const radiusMeters = query.radiusMeters ?? Number(c.env.DEFAULT_SEARCH_RADIUS_METERS);
  const options = { radiusMeters };
  const items = await queryRealtimeParkingCache(c.env.DB, query.lat, query.lng, options);
  return c.json({
    destination: { lat: query.lat, lng: query.lng, radiusMeters },
    items,
    generatedAt: new Date().toISOString()
  });
});

app.get("/parking/realtime/clusters", async (c) => {
  const query = parkingNearbySchema.parse(queryObject(c.req.raw.url));
  if (!c.env.DB) {
    return c.json({ error: "d1_not_configured" }, 503);
  }
  const radiusMeters = query.radiusMeters ?? Number(c.env.DEFAULT_SEARCH_RADIUS_METERS);
  const clusterMeters = query.clusterMeters ?? 5000;
  const clusters = await queryRealtimeParkingClusters(
    c.env.DB,
    query.lat,
    query.lng,
    { radiusMeters },
    clusterMeters
  );
  return c.json({
    destination: { lat: query.lat, lng: query.lng, radiusMeters },
    clusterMeters,
    clusters,
    generatedAt: new Date().toISOString()
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
    const result = await syncRealtimeParkingCache(c.env.DB, backend.realtimeParkingProvider);
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
    generatedAt: new Date().toISOString()
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
    radiusMeters: query.radiusMeters ?? Number(c.env.DEFAULT_DISCOVER_RADIUS_METERS),
    ongoingOnly: query.ongoingOnly,
    upcomingWithinDays: query.upcomingWithinDays ?? 30
  });
  return c.json({ items, generatedAt: new Date().toISOString() });
});

app.get("/discover/events", async (c) => {
  return c.json({ items: [], generatedAt: new Date().toISOString() });
});

app.get("/api/festivals", async (c) => {
  const query = discoverQuerySchema.parse(queryObject(c.req.raw.url));
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const items = await queryFestivalsFromCache(c.env.DB, query.lat, query.lng, {
    radiusMeters: query.radiusMeters ?? Number(c.env.DEFAULT_DISCOVER_RADIUS_METERS),
    ongoingOnly: query.ongoingOnly,
    upcomingWithinDays: query.upcomingWithinDays ?? 30
  });
  return c.json({ items, generatedAt: new Date().toISOString() });
});

app.get("/api/local-events", async (c) => {
  const query = localEventQuerySchema.parse(queryObject(c.req.raw.url));
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const result = await queryLocalEvents(c.env.DB, {
    lat: query.lat,
    lng: query.lng,
    radiusMeters: query.radiusMeters ?? Number(c.env.DEFAULT_DISCOVER_RADIUS_METERS),
    cursor: query.cursor,
    limit: query.limit,
    status: "approved"
  });
  return c.json({ ...result, generatedAt: new Date().toISOString() });
});

app.get("/api/local-events/:id", async (c) => {
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const item = await getLocalEvent(c.env.DB, c.req.param("id"));
  if (!item || item.status !== "approved") return c.json({ error: "not_found" }, 404);
  return c.json({ item, generatedAt: new Date().toISOString() });
});

app.post("/api/local-events/report", async (c) => {
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const item = await createLocalEventReport(c.env.DB, localEventReportSchema.parse(await c.req.json()));
  return c.json({ item, generatedAt: new Date().toISOString() }, 202);
});

app.post("/api/admin/local-events", async (c) => {
  const authResponse = authorizeAdminSync(c.req.raw, c.env);
  if (authResponse) return authResponse;
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const item = await createAdminLocalEvent(c.env.DB, adminLocalEventSchema.parse(await c.req.json()));
  return c.json({ item, generatedAt: new Date().toISOString() }, 201);
});

app.patch("/api/admin/local-events/:id/status", async (c) => {
  const authResponse = authorizeAdminSync(c.req.raw, c.env);
  if (authResponse) return authResponse;
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const item = await patchLocalEventStatus(c.env.DB, c.req.param("id"), localEventStatusPatchSchema.parse(await c.req.json()));
  if (!item) return c.json({ error: "not_found" }, 404);
  return c.json({ item, generatedAt: new Date().toISOString() });
});

app.patch("/api/admin/local-events/:id", async (c) => {
  const authResponse = authorizeAdminSync(c.req.raw, c.env);
  if (authResponse) return authResponse;
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const item = await updateAdminLocalEvent(c.env.DB, c.req.param("id"), adminLocalEventPatchSchema.parse(await c.req.json()));
  if (!item) return c.json({ error: "not_found" }, 404);
  return c.json({ item, generatedAt: new Date().toISOString() });
});

app.get("/api/map/items", async (c) => {
  const query = mapItemsQuerySchema.parse(queryObject(c.req.raw.url));
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const radiusMeters = query.radiusMeters ?? Number(c.env.DEFAULT_DISCOVER_RADIUS_METERS);
  const items: MapItem[] = [];
  if (query.type === "festival" || query.type === "all") {
    const festivals = await queryFestivalsFromCache(c.env.DB, query.lat, query.lng, {
      radiusMeters,
      ongoingOnly: query.ongoingOnly,
      upcomingWithinDays: query.upcomingWithinDays ?? 30
    });
    items.push(...festivals.map((item) => ({
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
      imageUrl: item.imageUrl
    })));
  }
  if (query.type === "event" || query.type === "all") {
    const events = await queryLocalEvents(c.env.DB, {
      lat: query.lat,
      lng: query.lng,
      radiusMeters,
      cursor: query.cursor,
      limit: query.limit,
      status: "approved"
    });
    items.push(...events.items.map(localEventMapItem));
  }
  return c.json({
    items: items.sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0) || a.distanceMeters - b.distanceMeters),
    generatedAt: new Date().toISOString()
  });
});

app.get("/discover/clusters", async (c) => {
  const query = discoveryClusterSchema.parse(queryObject(c.req.raw.url));
  if (!c.env.DB) return c.json({ error: "d1_not_configured" }, 503);
  const radiusMeters = query.radiusMeters ?? 460000;
  const clusterMeters = query.clusterMeters ?? 20000;
  const types = discoveryClusterTypes(query.types);
  const clusters = await queryDiscoveryClusters(c.env.DB, types, query.lat, query.lng, { radiusMeters }, clusterMeters);
  return c.json({
    destination: { lat: query.lat, lng: query.lng, radiusMeters },
    clusterMeters,
    clusters,
    generatedAt: new Date().toISOString()
  });
});

app.get("/discover/providers/health", async (c) => {
  const backend = await loadBackend(c.env);
  return c.json({
    providers: [...backend.festivalService.health(), ...backend.eventService.health()],
    generatedAt: new Date().toISOString()
  });
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
      dryRun: query.dryRun ?? false
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
      dryRun: true
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
    const result = await syncDiscoveryCache(c.env.DB, backend, discoverySyncKinds(query.kinds));
    return c.json({
      result,
      providers: [...backend.festivalService.health(), ...backend.eventService.health()],
      generatedAt: new Date().toISOString()
    });
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
  try {
    const result = await syncLocalEventDiscovery({
      db: c.env.DB,
      env: c.env,
      dryRun: query.dryRun ?? false
    });
    return c.json(result);
  } catch (error) {
    return c.json(syncErrorResponse(error), 502);
  }
});

app.notFound((c) => c.json({ error: "not_found" }, 404));

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    return app.fetch(request, env, ctx);
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!env.DB) return;
    if (controller.cron === "* * * * *") {
      ctx.waitUntil(syncRealtimeParkingScheduled(env));
      return;
    }
    if (controller.cron === "0 * * * *") {
      ctx.waitUntil(syncDiscoveryScheduled(env, ["festivals", "events"]));
      return;
    }
    if (controller.cron === "15 18 * * *") {
      ctx.waitUntil(syncLocalEventsScheduled(env));
      return;
    }
  }
};

async function syncRealtimeParkingScheduled(env: Env): Promise<void> {
  try {
    const backend = await loadBackend(env);
    await syncRealtimeParkingCache(env.DB!, backend.realtimeParkingProvider);
  } catch (error) {
    console.error("realtime parking sync failed", error);
  }
}

async function syncDiscoveryScheduled(env: Env, kinds: Array<"festivals" | "events">): Promise<void> {
  try {
    const backend = await loadBackend(env);
    await syncDiscoveryCache(env.DB!, backend, kinds);
  } catch (error) {
    console.error("discovery sync failed", error);
  }
}

async function syncLocalEventsScheduled(env: Env): Promise<void> {
  try {
    await syncLocalEventDiscovery({
      db: env.DB!,
      env
    });
  } catch (error) {
    console.error("local event discovery sync failed", error);
  }
}

function queryObject(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams.entries());
}

function discoveryClusterTypes(value: string | undefined): Array<"festival" | "event"> {
  const allowed = new Set(["festival", "event"]);
  const types = (value ?? "festival,event")
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is "festival" | "event" => allowed.has(item));
  return types.length > 0 ? types : ["festival", "event"];
}

function discoverySyncKinds(value: string | undefined): Array<"festivals" | "events"> {
  const allowed = new Set(["festivals", "events"]);
  const kinds = (value ?? "festivals,events")
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is "festivals" | "events" => allowed.has(item));
  return kinds.length > 0 ? kinds : ["festivals", "events"];
}

function authorizeAdminSync(request: Request, env: Env): Response | null {
  if (!env.SYNC_ADMIN_TOKEN) {
    return Response.json({ error: "sync_admin_token_not_configured" }, { status: 503 });
  }

  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (token !== env.SYNC_ADMIN_TOKEN) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  return null;
}

function syncErrorResponse(error: unknown): { error: string; message: string } {
  return {
    error: "sync_failed",
    message: error instanceof Error ? error.message : "Unknown sync error"
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
    { searchHistoryRepository }
  ] = await Promise.all([
    import("../../backend/src/services/destinationSearch.js"),
    import("../../backend/src/providers/createProviders.js"),
    import("../../backend/src/features/discover/festivals/festivalService.js"),
    import("../../backend/src/features/discover/events/eventService.js"),
    import("../../backend/src/features/analytics/searchHistoryService.js"),
    import("../../backend/src/features/analytics/SearchHistoryRepository.js")
  ]);

  return {
    searchDestination,
    parkingProvider: createCompositeParkingProvider({ d1: env.DB }),
    realtimeParkingProvider: createRealtimeParkingProvider(),
    festivalService: createFestivalService(),
    eventService: createEventService(),
    searchHistoryService: new SearchHistoryService(searchHistoryRepository)
  };
}

function syncProcessEnv(env: Env): void {
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      process.env[key] = value;
    }
  }
}
