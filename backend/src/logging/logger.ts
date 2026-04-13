import pino from "pino";
import { config } from "../config/env.js";

export const logger = pino({
  level: config.LOG_LEVEL,
  redact: ["req.headers.authorization", "*.serviceKey", "*.apiKey"]
});
