import { Hono } from "hono";
import { cors } from "hono/cors";
import { z, ZodError } from "zod";

type Env = {
  DB?: D1Database;
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
  KAKAO_REST_API_KEY?: string;
  KAKAO_LOCAL_BASE_URL: string;
  SEOUL_OPEN_DATA_KEY?: string;
  SEOUL_OPEN_DATA_BASE_URL: string;
  PUBLIC_DATA_SERVICE_KEY?: string;
  PUBLIC_DATA_ENV: "development" | "production";
  PUBLIC_DATA_BASE_URL: string;
};

type BackendModules = {
  searchDestination: typeof import("../../backend/src/services/destinationSearch.js").searchDestination;
  createCompositeParkingProvider: typeof import("../../backend/src/providers/createProviders.js").createCompositeParkingProvider;
  createFestivalService: typeof import("../../backend/src/features/discover/festivals/festivalService.js").createFestivalService;
  createEventService: typeof import("../../backend/src/features/discover/events/eventService.js").createEventService;
  SearchHistoryService: typeof import("../../backend/src/features/analytics/searchHistoryService.js").SearchHistoryService;
  searchHistoryRepository: typeof import("../../backend/src/features/analytics/SearchHistoryRepository.js").searchHistoryRepository;
};

type BackendRuntime = {
  searchDestination: BackendModules["searchDestination"];
  parkingProvider: ReturnType<BackendModules["createCompositeParkingProvider"]>;
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
  const backend = await loadBackend(c.env);
  const radiusMeters = query.radiusMeters ?? Number(c.env.DEFAULT_SEARCH_RADIUS_METERS);
  const options = {
    radiusMeters,
    preferPublic: query.preferPublic,
    evOnly: query.evOnly,
    accessibleOnly: query.accessibleOnly,
    bestWalkingDistanceBias: query.bestWalkingDistanceBias
  };
  const items = await backend.parkingProvider.nearby(query.lat, query.lng, options);
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
  const backend = await loadBackend(c.env);
  const items = await backend.festivalService.nearby({
    lat: query.lat,
    lng: query.lng,
    radiusMeters: query.radiusMeters ?? Number(c.env.DEFAULT_DISCOVER_RADIUS_METERS),
    ongoingOnly: query.ongoingOnly,
    upcomingWithinDays: query.upcomingWithinDays ?? 30
  });
  return c.json({ items, generatedAt: new Date().toISOString() });
});

app.get("/discover/events", async (c) => {
  const query = discoverQuerySchema.parse(queryObject(c.req.raw.url));
  const backend = await loadBackend(c.env);
  const items = await backend.eventService.nearby({
    lat: query.lat,
    lng: query.lng,
    radiusMeters: query.radiusMeters ?? Number(c.env.DEFAULT_DISCOVER_RADIUS_METERS),
    ongoingOnly: query.ongoingOnly,
    upcomingWithinDays: query.upcomingWithinDays ?? 30,
    freeOnly: query.freeOnly ?? true
  });
  return c.json({ items, generatedAt: new Date().toISOString() });
});

app.get("/discover/providers/health", async (c) => {
  const backend = await loadBackend(c.env);
  return c.json({
    providers: [...backend.festivalService.health(), ...backend.eventService.health()],
    generatedAt: new Date().toISOString()
  });
});

app.notFound((c) => c.json({ error: "not_found" }, 404));

export default app;

function queryObject(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams.entries());
}

async function loadBackend(env: Env): Promise<BackendRuntime> {
  syncProcessEnv(env);
  backendRuntime ??= importBackend(env);
  return backendRuntime;
}

async function importBackend(env: Env): Promise<BackendRuntime> {
  const [
    { searchDestination },
    { createCompositeParkingProvider },
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
