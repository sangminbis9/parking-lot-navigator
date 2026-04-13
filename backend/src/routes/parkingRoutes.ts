import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config/env.js";
import { MemoryCache } from "../cache/memoryCache.js";
import { createCompositeParkingProvider } from "../providers/createProviders.js";

const optionalBoolean = z
  .enum(["true", "false"])
  .transform((value) => value === "true")
  .optional();

const nearbySchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  radiusMeters: z.coerce.number().optional(),
  preferPublic: optionalBoolean,
  evOnly: optionalBoolean,
  accessibleOnly: optionalBoolean,
  bestWalkingDistanceBias: optionalBoolean
});

const provider = createCompositeParkingProvider();
const cache = new MemoryCache<unknown>();

export async function registerParkingRoutes(app: FastifyInstance) {
  app.get("/parking/nearby", async (request) => {
    const query = nearbySchema.parse(request.query);
    const options = {
      radiusMeters: query.radiusMeters ?? config.DEFAULT_SEARCH_RADIUS_METERS,
      preferPublic: query.preferPublic,
      evOnly: query.evOnly,
      accessibleOnly: query.accessibleOnly,
      bestWalkingDistanceBias: query.bestWalkingDistanceBias
    };
    const cacheKey = JSON.stringify({ lat: query.lat, lng: query.lng, options });
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const items = await provider.nearby(query.lat, query.lng, options);
    const response = {
      destination: { lat: query.lat, lng: query.lng, radiusMeters: options.radiusMeters },
      items,
      generatedAt: new Date().toISOString()
    };
    cache.set(cacheKey, response, config.CACHE_TTL_SECONDS);
    return response;
  });

  app.get("/parking/providers/health", async () => ({
    providers: provider.health(),
    generatedAt: new Date().toISOString()
  }));
}
