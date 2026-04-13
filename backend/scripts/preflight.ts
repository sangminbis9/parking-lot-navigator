import { config, assertProductionSecrets } from "../src/config/env.js";

const missing = assertProductionSecrets(config);

console.log("사전 점검을 시작합니다.");
console.log(`provider mode: ${config.PARKING_PROVIDER_MODE}`);
console.log(`stale threshold: ${config.STALE_THRESHOLD_SECONDS}s`);
console.log(`cache ttl: ${config.CACHE_TTL_SECONDS}s`);

if (missing.length > 0) {
  console.error(`누락된 환경 변수: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("사전 점검 통과");
