import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { searchDestination } from "../services/destinationSearch.js";

const querySchema = z.object({
  q: z.string().min(1)
});

export async function registerSearchRoutes(app: FastifyInstance) {
  app.get("/search/destination", async (request) => {
    const query = querySchema.parse(request.query);
    const items = await searchDestination(query.q);
    return { items };
  });
}
