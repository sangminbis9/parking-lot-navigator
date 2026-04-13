import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { config } from "../config/env.js";
import { errorHandler } from "../middleware/errorHandler.js";
import { registerParkingRoutes } from "../routes/parkingRoutes.js";
import { registerSearchRoutes } from "../routes/searchRoutes.js";

export async function createApp() {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: ["req.headers.authorization", "*.serviceKey", "*.apiKey"]
    },
    genReqId: () => randomUUID()
  });

  await app.register(cors, { origin: true });
  await app.register(sensible);
  app.setErrorHandler(errorHandler);

  app.get("/health", async () => ({ status: "ok", generatedAt: new Date().toISOString() }));
  await registerSearchRoutes(app);
  await registerParkingRoutes(app);

  return app;
}
