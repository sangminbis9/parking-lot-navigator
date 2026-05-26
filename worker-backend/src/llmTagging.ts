import { callAiJson } from "./agents/workersAiClient.js";
import { fallbackTag } from "./llmTaggingFallback.js";
import {
  buildSystemPrompt,
  TAGGING_VERSION,
  validateTaggingResult,
  type TaggingInput,
  type TaggingResult,
} from "./llmTaggingSchema.js";

export interface TaggingEnv {
  DB?: D1Database;
  AI?: Ai;
  TAGGING_MODEL?: string;
  TAGGING_BATCH_SIZE?: string;
  TAGGING_RUN_MAX_ROWS?: string;
  TAGGING_CONCURRENCY?: string;
}

export interface RunTaggingOptions {
  source: "cron" | "admin" | "backfill";
  mode?: "incremental" | "backfill";
  maxRows?: number;
}

export interface RunTaggingResult {
  source: string;
  mode: string;
  processed: number;
  succeededLlm: number;
  fallback: number;
  failed: number;
  llmCalls: number;
  llmErrors: number;
  durationMs: number;
}

interface FestivalTaggingRow {
  id: string;
  title: string;
  subtitle: string | null;
  category_text: string | null;
  source: string;
  tags_json: string | null;
}

interface LocalEventTaggingRow {
  id: string;
  title: string;
  description: string | null;
  benefit: string | null;
  event_type: string | null;
  source: string;
}

// Workers AI model used. Override via TAGGING_MODEL env var if needed.
// See: https://developers.cloudflare.com/workers-ai/models/
const DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export async function runTagging(
  env: TaggingEnv,
  options: RunTaggingOptions,
): Promise<RunTaggingResult> {
  const startedAt = Date.now();
  const mode = options.mode ?? "incremental";
  const result: RunTaggingResult = {
    source: options.source,
    mode,
    processed: 0,
    succeededLlm: 0,
    fallback: 0,
    failed: 0,
    llmCalls: 0,
    llmErrors: 0,
    durationMs: 0,
  };

  if (!env.DB) return finalize(result, startedAt);
  if (!env.AI) {
    console.warn("runTagging: AI binding missing — fallback only");
  }

  const model = env.TAGGING_MODEL || DEFAULT_MODEL;
  const batchSize = clamp(parseInt(env.TAGGING_BATCH_SIZE ?? "20", 10), 1, 50);
  const maxRows = clamp(
    options.maxRows ?? parseInt(env.TAGGING_RUN_MAX_ROWS ?? "200", 10),
    1,
    5000,
  );
  const concurrency = clamp(
    parseInt(env.TAGGING_CONCURRENCY ?? "2", 10),
    1,
    6,
  );

  const [festivalRows, localEventRows] = await Promise.all([
    fetchFestivalRows(env.DB, mode, maxRows),
    fetchLocalEventRows(env.DB, mode, maxRows),
  ]);

  const festivalInputs = festivalRows.map(festivalRowToInput);
  const localInputs = localEventRows.map(localEventRowToInput);

  await processDomain({
    env,
    domain: "festival",
    inputs: festivalInputs,
    model,
    batchSize,
    concurrency,
    result,
  });
  await processDomain({
    env,
    domain: "local_event",
    inputs: localInputs,
    model,
    batchSize,
    concurrency,
    result,
  });

  return finalize(result, startedAt);
}

function finalize(r: RunTaggingResult, startedAt: number): RunTaggingResult {
  r.durationMs = Date.now() - startedAt;
  return r;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

async function fetchFestivalRows(
  db: D1Database,
  mode: "incremental" | "backfill",
  limit: number,
): Promise<FestivalTaggingRow[]> {
  const where =
    mode === "backfill"
      ? "type = 'festival'"
      : "type = 'festival' AND (tagging_version = 0 OR tagging_version = -1)";
  const rs = await db
    .prepare(
      `SELECT id, title, subtitle, category_text, source, tags_json
       FROM discovery_items
       WHERE ${where}
       ORDER BY last_seen_at DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all<FestivalTaggingRow>();
  return rs.results ?? [];
}

async function fetchLocalEventRows(
  db: D1Database,
  mode: "incremental" | "backfill",
  limit: number,
): Promise<LocalEventTaggingRow[]> {
  const where =
    mode === "backfill"
      ? "1 = 1"
      : "tagging_version = 0 OR tagging_version = -1";
  const rs = await db
    .prepare(
      `SELECT id, title, description, benefit, event_type, source
       FROM local_events
       WHERE ${where}
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all<LocalEventTaggingRow>();
  return rs.results ?? [];
}

function festivalRowToInput(row: FestivalTaggingRow): TaggingInput {
  return {
    domain: "festival",
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    categoryText: row.category_text,
    tagsHint: row.tags_json,
    source: row.source,
  };
}

function localEventRowToInput(row: LocalEventTaggingRow): TaggingInput {
  return {
    domain: "local_event",
    id: row.id,
    title: row.title,
    description: row.description,
    benefit: row.benefit,
    categoryText: row.event_type,
    source: row.source,
  };
}

interface ProcessArgs {
  env: TaggingEnv;
  domain: "festival" | "local_event";
  inputs: TaggingInput[];
  model: string;
  batchSize: number;
  concurrency: number;
  result: RunTaggingResult;
}

async function processDomain(args: ProcessArgs): Promise<void> {
  if (args.inputs.length === 0) return;
  const batches: TaggingInput[][] = [];
  for (let i = 0; i < args.inputs.length; i += args.batchSize) {
    batches.push(args.inputs.slice(i, i + args.batchSize));
  }
  const queue = [...batches];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < args.concurrency; i++) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const batch = queue.shift();
          if (!batch) break;
          await processBatch(args, batch);
        }
      })(),
    );
  }
  await Promise.all(workers);
}

async function processBatch(
  args: ProcessArgs,
  batch: TaggingInput[],
): Promise<void> {
  args.result.processed += batch.length;
  let llmResults: TaggingResult[] = [];
  if (args.env.AI) {
    try {
      args.result.llmCalls += 1;
      llmResults = await tagBatchWithAi(
        args.env.AI,
        args.model,
        args.domain,
        batch,
      );
    } catch (error) {
      args.result.llmErrors += 1;
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(
        `runTagging batch failed domain=${args.domain} size=${batch.length} err=${msg}`,
      );
      llmResults = [];
    }
  }

  const succeeded = new Map(llmResults.map((r) => [r.id, r]));
  const finals: Array<{
    input: TaggingInput;
    result: TaggingResult;
    fromLlm: boolean;
  }> = [];
  for (const input of batch) {
    const llm = succeeded.get(input.id);
    if (llm) {
      finals.push({ input, result: llm, fromLlm: true });
      args.result.succeededLlm += 1;
    } else {
      finals.push({ input, result: fallbackTag(input), fromLlm: false });
      args.result.fallback += 1;
    }
  }

  if (!args.env.DB) return;
  try {
    await writeResults(args.env.DB, args.model, finals);
  } catch (error) {
    args.result.failed += finals.length;
    console.error("runTagging write failed", error);
  }
}

interface AiTaggingResponse {
  items?: unknown;
  results?: unknown;
}

async function tagBatchWithAi(
  ai: Ai,
  model: string,
  domain: "festival" | "local_event",
  batch: TaggingInput[],
): Promise<TaggingResult[]> {
  const items = batch.map((input) => ({
    id: input.id,
    title: input.title,
    subtitle: input.subtitle ?? null,
    categoryText: input.categoryText ?? null,
    benefit: input.benefit ?? null,
    description: input.description ?? null,
    source: input.source ?? null,
  }));
  // Workers AI json mode wraps the array in an object, so the prompt asks for
  // {"items": [...]} and we extract `items` after parsing.
  const userPrompt = `다음 ${items.length}개 항목을 분류하라. JSON 객체로 {"items": [...]} 형식으로 응답하라.\n입력:\n${JSON.stringify(items)}`;
  const parsed = await callAiJson<AiTaggingResponse>({
    ai,
    systemInstruction: buildSystemPrompt(domain),
    prompt: userPrompt,
    temperature: 0,
    maxOutputTokens: Math.min(4096, 256 + items.length * 80),
    jsonMode: true,
    model,
  });
  const rawArray = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.items)
      ? parsed.items
      : Array.isArray(parsed.results)
        ? parsed.results
        : [];
  const knownIds = new Set(batch.map((b) => b.id));
  return validateTaggingResult(domain, rawArray, knownIds);
}

async function writeResults(
  db: D1Database,
  model: string,
  finals: Array<{
    input: TaggingInput;
    result: TaggingResult;
    fromLlm: boolean;
  }>,
): Promise<void> {
  if (finals.length === 0) return;
  const taggedAt = new Date().toISOString();
  const festivalStmts: D1PreparedStatement[] = [];
  const localStmts: D1PreparedStatement[] = [];
  for (const { input, result, fromLlm } of finals) {
    const version = fromLlm ? TAGGING_VERSION : -1;
    const tagsJson = JSON.stringify(result.categoryTags);
    const stmtModel = fromLlm ? model : "fallback";
    if (input.domain === "festival") {
      festivalStmts.push(
        db
          .prepare(
            `UPDATE discovery_items
                SET primary_category = ?,
                    category_tags_json = ?,
                    tagging_version = ?,
                    tagged_at = ?,
                    tagging_model = ?
              WHERE id = ?`,
          )
          .bind(
            result.primaryCategory,
            tagsJson,
            version,
            taggedAt,
            stmtModel,
            input.id,
          ),
      );
    } else {
      localStmts.push(
        db
          .prepare(
            `UPDATE local_events
                SET primary_category = ?,
                    category_tags_json = ?,
                    tagging_version = ?,
                    tagged_at = ?,
                    tagging_model = ?
              WHERE id = ?`,
          )
          .bind(
            result.primaryCategory,
            tagsJson,
            version,
            taggedAt,
            stmtModel,
            input.id,
          ),
      );
    }
  }
  if (festivalStmts.length > 0) await db.batch(festivalStmts);
  if (localStmts.length > 0) await db.batch(localStmts);
}
