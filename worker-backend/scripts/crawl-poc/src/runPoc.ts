import { config as loadDotenv } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildReport, score } from "./common/report.js";
import { sampleStores } from "./common/sampleStores.js";
import type { CandidateSource, ScoredCandidate, SourceFetchResult, SourceRunSummary } from "./common/types.js";
import { crawlInstagramBusinessDiscovery } from "./sources/instagramBusinessDiscovery.js";
import { crawlKakaoPlaceFeed } from "./sources/kakaoPlaceFeed.js";
import { crawlNaverPlaceFeed } from "./sources/naverPlaceFeed.js";

type SourceArg = "all" | "kakao" | "naver" | "instagram";

interface CliOptions {
  source: SourceArg;
  saveFixture: boolean;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pocRoot = path.resolve(__dirname, "..");
const outDir = path.join(pocRoot, "out");
const fixtureDir = path.join(pocRoot, "fixtures");

loadDotenv({ path: path.resolve(process.cwd(), ".env.local") });
loadDotenv();

const cli = parseArgs(process.argv.slice(2));
const generatedAt = new Date().toISOString();
const selectedSources = sourceList(cli.source);
const rawResults: SourceFetchResult[] = [];
const summaries: SourceRunSummary[] = [];

for (const source of selectedSources) {
  if (source === "kakao_place_feed") {
    const results = await runKakao(cli.saveFixture);
    rawResults.push(...results);
    summaries.push(summarize(source, results));
  }
  if (source === "naver_place_feed") {
    const results = await runNaver(cli.saveFixture);
    rawResults.push(...results);
    summaries.push(summarize(source, results));
  }
  if (source === "instagram") {
    if (!process.env.IG_USER_ID || !process.env.IG_ACCESS_TOKEN) {
      summaries.push({
        source,
        attemptedStores: 0,
        successStores: 0,
        failedStores: 0,
        skippedStores: sampleStores.length,
        skippedReason: "skipped: no credentials"
      });
    } else {
      const results = await runInstagram();
      rawResults.push(...results);
      summaries.push(summarize(source, results));
    }
  }
}

const events = rawResults.flatMap((result) => result.events);
const scored: ScoredCandidate[] = events.map((event) => ({ event, score: score(event) }));

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "raw.json"), JSON.stringify({ generatedAt, summaries, results: rawResults, scored }, null, 2));
await writeFile(path.join(outDir, "report.md"), buildReport({ generatedAt, summaries, scored }));

console.log(`Wrote ${path.join(outDir, "report.md")}`);
console.log(`Wrote ${path.join(outDir, "raw.json")}`);

async function runKakao(saveFixture: boolean): Promise<SourceFetchResult[]> {
  const results: SourceFetchResult[] = [];
  for (const store of sampleStores) {
    results.push(await crawlKakaoPlaceFeed(store, { saveFixture, fixtureDir }));
  }
  return results;
}

async function runNaver(saveFixture: boolean): Promise<SourceFetchResult[]> {
  const results: SourceFetchResult[] = [];
  for (const store of sampleStores) {
    results.push(await crawlNaverPlaceFeed(store, { saveFixture, fixtureDir }));
  }
  return results;
}

async function runInstagram(): Promise<SourceFetchResult[]> {
  const results: SourceFetchResult[] = [];
  for (const store of sampleStores) {
    results.push(await crawlInstagramBusinessDiscovery(store));
  }
  return results;
}

function summarize(source: CandidateSource, results: SourceFetchResult[]): SourceRunSummary {
  return {
    source,
    attemptedStores: results.length,
    successStores: results.filter((result) => result.ok).length,
    failedStores: results.filter((result) => !result.ok && !result.reason?.startsWith("skipped:")).length,
    skippedStores: results.filter((result) => result.reason?.startsWith("skipped:")).length
  };
}

function parseArgs(args: string[]): CliOptions {
  let source: SourceArg = "all";
  let saveFixture = false;
  for (const arg of args) {
    if (arg.startsWith("--source=")) {
      const value = arg.replace("--source=", "");
      if (value === "all" || value === "kakao" || value === "naver" || value === "instagram") {
        source = value;
      }
    }
    if (arg === "--save-fixture") {
      saveFixture = true;
    }
  }
  return { source, saveFixture };
}

function sourceList(value: SourceArg): CandidateSource[] {
  if (value === "kakao") return ["kakao_place_feed"];
  if (value === "naver") return ["naver_place_feed"];
  if (value === "instagram") return ["instagram"];
  return ["kakao_place_feed", "naver_place_feed", "instagram"];
}
