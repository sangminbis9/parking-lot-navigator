import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../config/env.js";
import { createFestivalService } from "./festivals/festivalService.js";

const optionalBoolean = z
  .enum(["true", "false"])
  .transform((value) => value === "true")
  .optional();

const discoverQuerySchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  radiusMeters: z.coerce.number().optional(),
  ongoingOnly: optionalBoolean,
  upcomingWithinDays: z.coerce.number().min(0).max(365).optional(),
  freeOnly: optionalBoolean
});

const festivalService = createFestivalService();

export async function registerDiscoverRoutes(app: FastifyInstance) {
  app.get("/discover/festivals", async (request) => {
    const query = discoverQuerySchema.parse(request.query);
    const items = await festivalService.nearby({
      lat: query.lat,
      lng: query.lng,
      radiusMeters: query.radiusMeters ?? config.DEFAULT_DISCOVER_RADIUS_METERS,
      ongoingOnly: query.ongoingOnly,
      upcomingWithinDays: query.upcomingWithinDays ?? 30
    });
    return { items, generatedAt: new Date().toISOString() };
  });

  app.get("/discover/events", async (_request, reply) => {
    return reply.code(410).send({
      error: "deprecated",
      message: "Use /api/festivals for public festival data or /api/local-events for store events."
    });
  });

  app.get("/discover/providers/health", async () => ({
    providers: festivalService.health(),
    generatedAt: new Date().toISOString()
  }));
}
