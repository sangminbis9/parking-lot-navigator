import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../config/env.js";
import type { Festival, LocalEvent, MapItem } from "@parking/shared-types";
import { createFestivalService } from "../discover/festivals/festivalService.js";
import { createLocalEventService } from "./localEventService.js";

const optionalBoolean = z
  .enum(["true", "false"])
  .transform((value) => value === "true")
  .optional();

const mapTypeSchema = z.enum(["festival", "event", "all"]).default("all");
const eventSourceSchema = z.enum(["instagram", "naver_place", "owner_submitted", "admin_manual", "user_report", "official_site", "other"]);
const eventStatusSchema = z.enum(["pending", "approved", "rejected", "expired"]);
const eventTypeSchema = z.enum(["discount", "freebie", "review_event", "popup", "limited_menu", "opening_event", "etc"]);

const nearbyQuerySchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  radiusMeters: z.coerce.number().optional(),
  upcomingWithinDays: z.coerce.number().min(0).max(365).optional(),
  ongoingOnly: optionalBoolean,
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

const reportSchema = z.object({
  sourceUrl: z.string().url().nullable().optional(),
  captionText: z.string().max(5000).nullable().optional(),
  storeName: z.string().max(200).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  note: z.string().max(1000).nullable().optional()
});

const adminUpsertSchema = z.object({
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

const adminPatchSchema = adminUpsertSchema.partial().extend({
  source: eventSourceSchema.optional()
});

const statusPatchSchema = z.object({
  status: eventStatusSchema,
  rejectionReason: z.string().max(1000).nullable().optional()
});

const festivalService = createFestivalService();
const localEventService = createLocalEventService();

export async function registerLocalEventRoutes(app: FastifyInstance) {
  app.get("/api/festivals", async (request) => {
    const query = nearbyQuerySchema.parse(request.query);
    const items = await festivalService.nearby({
      lat: query.lat,
      lng: query.lng,
      radiusMeters: query.radiusMeters ?? config.DEFAULT_DISCOVER_RADIUS_METERS,
      ongoingOnly: query.ongoingOnly,
      upcomingWithinDays: query.upcomingWithinDays ?? 30
    });
    return { items, generatedAt: new Date().toISOString() };
  });

  app.get("/api/local-events", async (request) => {
    const query = nearbyQuerySchema.parse(request.query);
    return {
      ...localEventService.list({
        lat: query.lat,
        lng: query.lng,
        radiusMeters: query.radiusMeters ?? config.DEFAULT_DISCOVER_RADIUS_METERS,
        cursor: query.cursor,
        limit: query.limit
      }),
      generatedAt: new Date().toISOString()
    };
  });

  app.get("/api/local-events/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const item = localEventService.get(params.id);
    if (!item) return reply.notFound("local event not found");
    return { item, generatedAt: new Date().toISOString() };
  });

  app.post("/api/local-events/report", async (request, reply) => {
    const item = localEventService.report(reportSchema.parse(request.body));
    return reply.code(202).send({ item, generatedAt: new Date().toISOString() });
  });

  app.post("/api/admin/local-events", async (request, reply) => {
    const item = localEventService.create(adminUpsertSchema.parse(request.body));
    return reply.code(201).send({ item, generatedAt: new Date().toISOString() });
  });

  app.patch("/api/admin/local-events/:id/status", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const item = localEventService.patchStatus(params.id, statusPatchSchema.parse(request.body));
    if (!item) return reply.notFound("local event not found");
    return { item, generatedAt: new Date().toISOString() };
  });

  app.patch("/api/admin/local-events/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const item = localEventService.update(params.id, adminPatchSchema.parse(request.body));
    if (!item) return reply.notFound("local event not found");
    return { item, generatedAt: new Date().toISOString() };
  });

  app.get("/api/map/items", async (request) => {
    const query = nearbyQuerySchema.extend({ type: mapTypeSchema }).parse(request.query);
    const radiusMeters = query.radiusMeters ?? config.DEFAULT_DISCOVER_RADIUS_METERS;
    const results: MapItem[] = [];
    if (query.type === "festival" || query.type === "all") {
      const festivals = await festivalService.nearby({
        lat: query.lat,
        lng: query.lng,
        radiusMeters,
        ongoingOnly: query.ongoingOnly,
        upcomingWithinDays: query.upcomingWithinDays ?? 30
      });
      results.push(...festivals.map(festivalMapItem));
    }
    if (query.type === "event" || query.type === "all") {
      const events = localEventService.list({
        lat: query.lat,
        lng: query.lng,
        radiusMeters,
        cursor: query.cursor,
        limit: query.limit
      });
      results.push(...events.items.map(localEventMapItem));
    }
    return {
      items: results.sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0) || a.distanceMeters - b.distanceMeters),
      generatedAt: new Date().toISOString()
    };
  });
}

function festivalMapItem(item: Festival): MapItem {
  return {
    id: `festival:${item.id}`,
    type: "festival",
    title: item.title,
    subtitle: item.subtitle ?? item.venueName ?? item.address,
    lat: item.lat,
    lng: item.lng,
    distanceMeters: item.distanceMeters,
    markerType: "festival",
    source: item.source,
    sourceUrl: item.sourceUrl,
    imageUrl: item.imageUrl
  };
}

function localEventMapItem(item: LocalEvent): MapItem {
  return {
    id: `event:${item.id}`,
    type: "event",
    title: item.title,
    subtitle: item.benefit ?? item.storeName,
    lat: item.lat,
    lng: item.lng,
    distanceMeters: item.distanceMeters,
    markerType: "local_event",
    source: item.source,
    sourceUrl: item.sourceUrl,
    imageUrl: item.imageUrl,
    isSponsored: item.isSponsored,
    priorityScore: item.priorityScore
  };
}
