import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CandidateSource, ScoredCandidate, SourceFetchResult, SourceRunSummary } from "./common/types.js";

interface RawOutput {
  summaries?: SourceRunSummary[];
  results?: SourceFetchResult[];
  scored?: ScoredCandidate[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pocRoot = path.resolve(__dirname, "..");
const rawPath = path.join(pocRoot, "out", "raw.json");
const reportPath = path.join(pocRoot, "out", "report.md");

const raw = await readRawOutput();
const summaries = raw.summaries ?? [];
const results = raw.results ?? [];
const scored = raw.scored ?? [];

console.log("");
console.log("Next steps");
console.log("----------");
console.log(`1. Open the report: ${reportPath}`);
console.log("2. Check whether Kakao/Naver produced real candidates before changing production crawlers.");

const missingKakao = countReason(results, "kakao_place_feed", "missing kakaoPlaceId");
const missingNaver = countReason(results, "naver_place_feed", "missing naverPlaceId");
const instagramSkipped = summaries.find((item) => item.source === "instagram")?.skippedReason;

if (missingKakao > 0 || missingNaver > 0) {
  console.log(`3. Fill PoC ids in scripts/crawl-poc/src/common/sampleStores.ts. Missing Kakao ids: ${missingKakao}, missing Naver ids: ${missingNaver}.`);
} else {
  console.log("3. Review failed rows in raw.json and decide whether parser fixtures are needed.");
}

if (instagramSkipped === "skipped: no credentials") {
  console.log("4. To test Instagram, create worker-backend/.env.local with IG_USER_ID and IG_ACCESS_TOKEN, then rerun.");
} else {
  console.log("4. Compare Instagram score against Kakao/Naver in the Quality Metrics table.");
}

const bestSource = bestSourceByComposite(scored);
if (bestSource) {
  console.log(`5. Current best source by average composite score: ${bestSource.source} (${bestSource.average.toFixed(2)}).`);
} else {
  console.log("5. No scored candidates yet. Add place ids/credentials first, then rerun the PoC.");
}

console.log("");

async function readRawOutput(): Promise<RawOutput> {
  try {
    return JSON.parse(await readFile(rawPath, "utf8")) as RawOutput;
  } catch {
    return {};
  }
}

function countReason(results: SourceFetchResult[], source: CandidateSource, reasonPart: string): number {
  return results.filter((item) => item.source === source && item.reason?.includes(reasonPart)).length;
}

function bestSourceByComposite(scoredRows: ScoredCandidate[]): { source: CandidateSource; average: number } | null {
  const sourceScores = new Map<CandidateSource, number[]>();
  for (const row of scoredRows) {
    const values = sourceScores.get(row.event.source) ?? [];
    values.push(row.score.composite);
    sourceScores.set(row.event.source, values);
  }

  let best: { source: CandidateSource; average: number } | null = null;
  for (const [source, scores] of sourceScores) {
    const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    if (!best || average > best.average) {
      best = { source, average };
    }
  }
  return best;
}
