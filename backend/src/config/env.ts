import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.string().default("info"),
  PARKING_PROVIDER_MODE: z.enum(["mock", "real", "hybrid"]).default("mock"),
  DEFAULT_SEARCH_RADIUS_METERS: z.coerce.number().default(800),
  STALE_THRESHOLD_SECONDS: z.coerce.number().default(600),
  CACHE_TTL_SECONDS: z.coerce.number().default(60),
  KAKAO_REST_API_KEY: z.string().optional(),
  KAKAO_LOCAL_BASE_URL: z.string().url().default("https://dapi.kakao.com"),
  SEOUL_OPEN_DATA_KEY: z.string().optional(),
  SEOUL_OPEN_DATA_BASE_URL: z.string().default("http://openapi.seoul.go.kr:8088"),
  PUBLIC_DATA_SERVICE_KEY: z.string().optional(),
  PUBLIC_DATA_ENV: z.enum(["development", "production"]).default("development"),
  PUBLIC_DATA_BASE_URL: z.string().url().default("https://apis.data.go.kr")
});

export type AppConfig = z.infer<typeof envSchema>;

export const config: AppConfig = envSchema.parse(process.env);

export function assertProductionSecrets(cfg: AppConfig): string[] {
  const missing: string[] = [];
  if (cfg.PARKING_PROVIDER_MODE !== "mock") {
    if (!cfg.KAKAO_REST_API_KEY) missing.push("KAKAO_REST_API_KEY");
    if (!cfg.SEOUL_OPEN_DATA_KEY) missing.push("SEOUL_OPEN_DATA_KEY");
    if (!cfg.PUBLIC_DATA_SERVICE_KEY) missing.push("PUBLIC_DATA_SERVICE_KEY");
  }
  return missing;
}
