import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../config/env.js";
import { createEventService } from "./events/eventService.js";
import { createFestivalService } from "./festivals/festivalService.js";
import { createLodgingService } from "./lodging/lodgingService.js";

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
  freeOnly: optionalBoolean,
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  adults: z.coerce.number().int().min(1).max(14).optional(),
  rooms: z.coerce.number().int().min(1).max(8).optional()
});

const festivalService = createFestivalService();
const eventService = createEventService();
const lodgingService = createLodgingService();

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

  app.get("/discover/events", async (request) => {
    const query = discoverQuerySchema.parse(request.query);
    const items = await eventService.nearby({
      lat: query.lat,
      lng: query.lng,
      radiusMeters: query.radiusMeters ?? config.DEFAULT_DISCOVER_RADIUS_METERS,
      ongoingOnly: query.ongoingOnly,
      upcomingWithinDays: query.upcomingWithinDays ?? 30,
      freeOnly: query.freeOnly ?? true
    });
    return { items, generatedAt: new Date().toISOString() };
  });

  app.get("/discover/lodging", async (request) => {
    const query = discoverQuerySchema.parse(request.query);
    const items = await lodgingService.nearby({
      lat: query.lat,
      lng: query.lng,
      radiusMeters: query.radiusMeters ?? config.DEFAULT_DISCOVER_RADIUS_METERS,
      ongoingOnly: query.ongoingOnly,
      upcomingWithinDays: query.upcomingWithinDays ?? 30,
      checkIn: query.checkIn,
      checkOut: query.checkOut,
      adults: query.adults,
      rooms: query.rooms
    });
    return { items, generatedAt: new Date().toISOString() };
  });

  app.get("/discover/providers/health", async () => ({
    providers: [...festivalService.health(), ...eventService.health(), ...lodgingService.health()],
    generatedAt: new Date().toISOString()
  }));
}
