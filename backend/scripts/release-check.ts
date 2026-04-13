import { config, assertProductionSecrets } from "../src/config/env.js";

const failures: string[] = [];
if (config.NODE_ENV !== "production") failures.push("NODE_ENV가 production이 아닙니다.");
if (config.PARKING_PROVIDER_MODE === "mock") failures.push("운영 배포에서 PARKING_PROVIDER_MODE=mock은 허용하지 않습니다.");
failures.push(...assertProductionSecrets(config).map((key) => `${key}가 누락되었습니다.`));

if (failures.length > 0) {
  console.error("릴리스 점검 실패");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("릴리스 점검 통과");
