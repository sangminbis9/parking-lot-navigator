import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { searchHistoryRepository } from "./SearchHistoryRepository.js";
import { SearchHistoryService } from "./searchHistoryService.js";

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

const service = new SearchHistoryService(searchHistoryRepository);

export async function registerAnalyticsRoutes(app: FastifyInstance) {
  app.post("/analytics/search-history", async (request, reply) => {
    const body = createSearchHistorySchema.parse(request.body);
    const record = await service.create(body);
    return reply.code(201).send(record);
  });

  app.get("/analytics/search-history", async (request) => {
    const query = listQuerySchema.parse(request.query);
    return {
      items: await service.list(query.deviceId),
      generatedAt: new Date().toISOString()
    };
  });

  app.get("/analytics/search-history/stats", async (request) => {
    const query = listQuerySchema.parse(request.query);
    return service.stats(query.deviceId);
  });
}
