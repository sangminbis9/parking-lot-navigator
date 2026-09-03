import { fetchWithTimeout } from "../../backend/src/features/discover/events/eventProviderUtils.js";
import { callAiJson } from "./agents/workersAiClient.js";
import { mapWithConcurrency } from "./concurrency.js";
import { isRetryableBackfillError } from "./backfillRetry.js";
import { seoulDayString } from "./kstDate.js";

// public-data-culture-festival / seoul_open_data / city-scraped는 원본 목록에도
// detail API에도 프로그램 필드가 없다. 있는 것은 주최측 홈페이지 URL뿐이라,
// 그 페이지를 직접 열어 프로그램·일정 텍스트를 뽑는다.
//
// feeBackfill과 같은 네 상태(migration 0026)를 그대로 쓴다. 소스 집합이
// 서로 겹치지 않으므로(feeBackfill은 kopis/tourapi 계열) 같은 컬럼을 나눠 써도
// 서로의 재시도 시각을 덮지 않는다. 새 테이블도 새 인덱스도 만들지 않는다 —
// discovery_items는 이미 인덱스 11개라 하나 늘릴 때마다 하루 쓰기가 통째로 는다.
//
// 못 찾으면 detail_state='empty' + detail_retry_after로 다시 큐에 들어가고,
// 행사가 가까울수록 짧은 간격으로 다시 본다. "행사 며칠 전에 공개되는가"라는
// 고정 리드타임 대신 임박도 backoff를 쓰는 이유는, 그 리드타임을 우리 데이터로
// 측정할 수 없기 때문이다(program_filled_at은 공개 시점이 아니라 백필 도달 시점이다).

// 회차 크기를 정하는 것은 subrequest(50)가 아니라 **CPU 한도**다. 2026-09-02
// 04:10 UTC 슬롯에서 12건 회차가 `Exceeded CPU Limit`으로 통째로 죽었고(선점만
// 남고 결과가 한 건도 안 쓰였다), 같은 tail 창에서 실제 작업을 하는 다른 cron
// invocation도 상시 초과 중이었다. HTML 파싱이 이 파이프라인에서 가장 무거운
// CPU 소비원이라, 항목 수·동시성·본문 상한을 모두 낮춰 잡는다.
const DEFAULT_MAX_ITEMS = 4;
const DEFAULT_MAX_LLM_CALLS = 4;
const CRAWL_CONCURRENCY = 2;
// 청크가 작을수록 죽기 전까지의 작업이 더 많이 남는다.
const FLUSH_CHUNK = 2;
const CLAIM_TTL_MINUTES = 15;
const TRANSIENT_BACKOFF_BASE_MINUTES = 5;
const TRANSIENT_BACKOFF_MAX_MINUTES = 6 * 60;
const FETCH_TIMEOUT_MS = 8_000;
/// 본문을 통째로 정규식에 태우면 CPU 예산이 먼저 죽는다. 프로그램 안내는 대개
/// 문서 앞쪽에 있어 이 상한으로 잘라도 잃는 것이 적다.
const MAX_HTML_CHARS = 60_000;
/// LLM에 넘길 본문 상한. 토큰 비용과 Neuron 예산(하루 10,000) 때문에 자른다.
const MAX_LLM_CHARS = 6_000;
const MAX_PROGRAM_CHARS = 800;

const CRAWL_SOURCES = [
  "public-data-culture-festival",
  "seoul_open_data",
  "city-scraped",
];

/// 프로그램 정보가 시작되는 자리를 가리키는 제목.
const PROGRAM_HEADING =
  /(프로그램|행사\s*일정|공연\s*일정|축제\s*일정|주요\s*행사|주요\s*내용|타임\s*테이블|타임테이블|시간표|세부\s*일정|운영\s*내용)/;
/// 여기부터는 프로그램이 아니다. 본문이 끝났다고 보고 수집을 멈춘다.
const PROGRAM_STOP =
  /(오시는\s*길|찾아오시는|교통\s*안내|주차\s*안내|문의처|개인정보|저작권|Copyright|이용약관|SNS|바로가기|URL\s*주소복사|주소\s*복사|관심\s*있어요|공유하기|목록으로|인쇄하기|요금\s*정보|관람\s*요금|주관\s*기관|주최\s*기관|홈페이지)/i;
/// 프로그램 사이에 섞여 들어오는 사이트 UI 부스러기. 여기서 수집을 끊으면 그 아래
/// 진짜 일정까지 잃으므로(공유 버튼이 본문 위에 있는 페이지가 많다) 줄만 버린다.
const PROGRAM_SKIP_LINE =
  /((페이스북|트위터|카카오톡|밴드|네이버)\s*공유|상세보기\s*-|장소보기|지도보기|등록\s*문의|첨부파일)/;
/// 프로그램 한 줄임을 스스로 증명하는 모양(시각 표기).
const TIME_LINE =
  /(\d{1,2}\s*:\s*\d{2}|\d{1,2}\s*시\s*\d{0,2}\s*분?|오전\s*\d{1,2}|오후\s*\d{1,2}|\d{1,2}\s*월\s*\d{1,2}\s*일)/;

interface CrawlRow {
  id: string;
  source: string;
  title: string | null;
  source_url: string | null;
  start_date: string | null;
  end_date: string | null;
  detail_attempts: number;
}

export interface ProgramCrawlResult {
  /** 이번 회차에 선점해 처리한 행 수. */
  scanned: number;
  /** 실제로 연 페이지 수(=소모한 subrequest). */
  pagesFetched: number;
  /** 규칙만으로 뽑아낸 행. */
  ruleFilled: number;
  /** 규칙이 실패해 LLM으로 뽑아낸 행. */
  llmFilled: number;
  /** LLM이 답했지만 원문에 없는 문장이라 버린 행. */
  llmRejected: number;
  llmCalls: number;
  /** 열렸지만 프로그램이 없어 backoff 뒤 다시 볼 행. */
  emptyPending: number;
  /** 영구 조회 불필요로 확정한 행(404·잘못된 URL·종료된 행사). */
  permanentNoData: number;
  /** 429/5xx/timeout 등 일시적 실패. 확정하지 않고 backoff만 건다. */
  transientFailed: number;
  /** 아직 프로그램을 못 채운 진행/예정 행 수. */
  backlog: number;
  errors?: string[];
  reason?: "max_items_zero" | "no_pending_rows";
}

export interface ProgramCrawlEnv {
  AI?: Ai;
  TAGGING_MODEL?: string;
  PROGRAM_CRAWL_MAX_ITEMS?: string;
  PROGRAM_CRAWL_MAX_LLM_CALLS?: string;
}

export async function runProgramCrawl(
  db: D1Database,
  env: ProgramCrawlEnv,
  options: { maxItems?: number; now?: Date } = {},
): Promise<ProgramCrawlResult> {
  const now = options.now ?? new Date();
  const maxItems = options.maxItems ?? positiveInt(env.PROGRAM_CRAWL_MAX_ITEMS, DEFAULT_MAX_ITEMS);
  const result: ProgramCrawlResult = {
    scanned: 0,
    pagesFetched: 0,
    ruleFilled: 0,
    llmFilled: 0,
    llmRejected: 0,
    llmCalls: 0,
    emptyPending: 0,
    permanentNoData: 0,
    transientFailed: 0,
    backlog: 0,
  };
  if (maxItems <= 0) return { ...result, reason: "max_items_zero" };

  const nowIso = now.toISOString();
  const today = seoulDayString(now);
  const placeholders = CRAWL_SOURCES.map(() => "?").join(",");

  result.backlog = await backlog(db, today);

  // 원본 sync가 이미 프로그램을 준 행은 크롤하지 않는다. seoul_open_data는
  // 공연시간/관람대상을 그대로 싣는 행이 41%(2026-09-02 실측 453/1112)라, 빼지 않으면
  // 회차 4건 예산의 절반을 이미 아는 정보에 쓰고 원본을 더 나쁜 추출로 덮을 수 있다
  // (영등포문화재단 행이 실제로 그렇게 덮였다).
  const rows = await db
    .prepare(
      `SELECT id, source, title, source_url, start_date, end_date, detail_attempts
         FROM discovery_items
        WHERE source IN (${placeholders})
          AND program_filled_at IS NULL
          AND json_extract(raw_payload, '$.programInfo') IS NULL
          AND source_url IS NOT NULL
          AND source_url <> ''
          AND (end_date IS NULL OR end_date >= ?)
          AND (detail_state IS NULL OR detail_state <> 'nodata')
          AND (detail_retry_after IS NULL OR detail_retry_after <= ?)
        ORDER BY detail_attempts ASC, start_date ASC
        LIMIT ?`,
    )
    .bind(...CRAWL_SOURCES, today, nowIso, maxItems)
    .all<CrawlRow>();

  const targets = rows.results ?? [];
  if (targets.length === 0) return { ...result, reason: "no_pending_rows" };

  // 선점을 먼저 쓴다. 없이 fetch하면 invocation이 죽었을 때 같은 행이 영원히 선두에 남는다.
  const claimUntil = plusMinutes(now, CLAIM_TTL_MINUTES);
  await flush(
    db,
    targets.map((row) =>
      db
        .prepare(
          `UPDATE discovery_items
              SET detail_attempts = detail_attempts + 1,
                  detail_retry_after = ?
            WHERE id = ?`,
        )
        .bind(claimUntil, row.id),
    ),
  );

  const maxLlmCalls = env.AI
    ? positiveInt(env.PROGRAM_CRAWL_MAX_LLM_CALLS, DEFAULT_MAX_LLM_CALLS)
    : 0;
  let llmBudget = maxLlmCalls;
  const errorSamples = new Set<string>();

  for (let start = 0; start < targets.length; start += FLUSH_CHUNK) {
    const chunk = targets.slice(start, start + FLUSH_CHUNK);
    // 페이지 수집(규칙 추출까지)은 병렬로, LLM 폴백은 예산을 순차로 깎아야 하므로
    // 청크가 끝난 뒤 직렬로 돈다.
    const crawled = await mapWithConcurrency(
      chunk,
      CRAWL_CONCURRENCY,
      async (row) => {
        try {
          return { row, ...(await crawlRow(row)), error: null as string | null };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { row, program: null, text: null, pages: 1, error: message };
        }
      },
    );

    const statements: D1PreparedStatement[] = [];
    for (const item of crawled) {
      const { row, error, text, pages } = item;
      let program = item.program;
      result.scanned += 1;
      result.pagesFetched += pages;

      if (error) {
        if (errorSamples.size < 5) errorSamples.add(error);
        if (isRetryableBackfillError(error)) {
          result.transientFailed += 1;
          statements.push(
            db
              .prepare(`UPDATE discovery_items SET detail_retry_after = ? WHERE id = ?`)
              .bind(transientRetryAfter(now, row), row.id),
          );
          continue;
        }
        result.permanentNoData += 1;
        statements.push(terminalStatement(db, row.id, nowIso));
        continue;
      }

      if (program) {
        result.ruleFilled += 1;
      } else if (text && llmBudget > 0) {
        llmBudget -= 1;
        result.llmCalls += 1;
        const extracted = await extractWithAi(env, row, text);
        if (extracted === "rejected") {
          result.llmRejected += 1;
        } else if (extracted) {
          program = extracted;
          result.llmFilled += 1;
        }
      }

      statements.push(outcomeStatement(db, row, program, now, nowIso, today));
      if (!program) {
        if (hasEnded(row, today)) result.permanentNoData += 1;
        else result.emptyPending += 1;
      }
    }
    await flush(db, statements);
  }

  if (errorSamples.size > 0) result.errors = [...errorSamples];
  return result;
}

// ── Queue 단계 실행 ────────────────────────────────────────────────────────
// 위 runProgramCrawl은 한 invocation에서 "선점 → 랜딩 fetch → 링크 fetch → LLM"을
// 전부 이어 붙인다. 그게 Free Worker의 10ms CPU를 넘겨 회차가 통째로 죽던 원인이라,
// Queue 경로에서는 같은 일을 단계로 쪼개 각 단계가 자기 invocation의 CPU 예산을
// 통째로 쓴다. 상태 컬럼(detail_state / detail_retry_after / detail_attempts /
// program_filled_at)과 판정 규칙은 위와 **완전히 같은 함수**를 공유한다 —
// admin endpoint(runProgramCrawl)와 Queue 경로가 서로 다른 정책을 갖지 않게 하려는 것이다.

export interface ProgramCrawlTarget {
  id: string;
  url: string;
}

/**
 * 대상 선정 + 선점만 한다. fetch를 하지 않으므로 subrequest 0건이고 CPU도 거의 안 쓴다.
 * 선점(detail_retry_after = now + 15분)이 걸려 있어, 뒤이은 단계 메시지가 유실되거나
 * CPU로 죽어도 그 행은 15분 뒤 자연히 다시 선정된다.
 */
export async function selectProgramCrawlTargets(
  db: D1Database,
  options: { maxItems: number; now?: Date },
): Promise<ProgramCrawlTarget[]> {
  const now = options.now ?? new Date();
  if (options.maxItems <= 0) return [];
  const nowIso = now.toISOString();
  const today = seoulDayString(now);
  const placeholders = CRAWL_SOURCES.map(() => "?").join(",");

  const rows = await db
    .prepare(
      `SELECT id, source_url
         FROM discovery_items
        WHERE source IN (${placeholders})
          AND program_filled_at IS NULL
          AND json_extract(raw_payload, '$.programInfo') IS NULL
          AND source_url IS NOT NULL
          AND source_url <> ''
          AND (end_date IS NULL OR end_date >= ?)
          AND (detail_state IS NULL OR detail_state <> 'nodata')
          AND (detail_retry_after IS NULL OR detail_retry_after <= ?)
        ORDER BY detail_attempts ASC, start_date ASC
        LIMIT ?`,
    )
    .bind(...CRAWL_SOURCES, today, nowIso, options.maxItems)
    .all<{ id: string; source_url: string }>();

  const targets = rows.results ?? [];
  if (targets.length === 0) return [];

  const claimUntil = plusMinutes(now, CLAIM_TTL_MINUTES);
  await flush(
    db,
    targets.map((row) =>
      db
        .prepare(
          `UPDATE discovery_items
              SET detail_attempts = detail_attempts + 1,
                  detail_retry_after = ?
            WHERE id = ?`,
        )
        .bind(claimUntil, row.id),
    ),
  );

  return targets.map((row) => ({ id: row.id, url: row.source_url }));
}

export type ProgramStage = "page" | "subpage" | "ai";

export interface ProgramStageResult {
  outcome: "filled" | "empty" | "nodata" | "transient" | "handed_off" | "skipped";
  /** 다음 단계로 넘길 작업. 스케줄러가 Queue 메시지로 만든다. */
  next?: { stage: "subpage" | "ai"; id: string; url: string };
  pagesFetched: number;
  llmCalls: number;
  llmRejected: number;
  error?: string;
}

/**
 * 단계 하나 = 페이지 하나. 최대 fetch 1건 + D1 쓰기 1건이라
 * subrequest도 CPU도 한 페이지분으로 묶인다.
 *
 * 같은 메시지가 두 번 와도(at-least-once) 안전하다: 이미 채워진 행은 `skipped`로
 * 빠지고, 그 외에는 같은 URL을 다시 읽어 같은 결론을 낼 뿐이라 행이 깨지지 않는다.
 */
export async function runProgramStage(
  db: D1Database,
  env: ProgramCrawlEnv,
  job: { stage: ProgramStage; id: string; url: string },
  options: { now?: Date } = {},
): Promise<ProgramStageResult> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const today = seoulDayString(now);
  const base: ProgramStageResult = {
    outcome: "skipped",
    pagesFetched: 0,
    llmCalls: 0,
    llmRejected: 0,
  };

  const loaded = await db
    .prepare(
      `SELECT id, source, title, source_url, start_date, end_date, detail_attempts,
              program_filled_at
         FROM discovery_items
        WHERE id = ?`,
    )
    .bind(job.id)
    .all<CrawlRow & { program_filled_at: string | null }>();
  const row = loaded.results?.[0];
  // 행이 사라졌거나(프루닝) 이미 프로그램이 채워졌으면(중복 메시지) 아무것도 하지 않는다.
  if (!row || row.program_filled_at) return base;

  let page: { html: string; text: string; url: URL };
  try {
    page = await fetchPageText(job.url);
    base.pagesFetched = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    base.error = message;
    if (isRetryableBackfillError(message)) {
      await db
        .prepare(`UPDATE discovery_items SET detail_retry_after = ? WHERE id = ?`)
        .bind(transientRetryAfter(now, row), row.id)
        .run();
      return { ...base, outcome: "transient" };
    }
    await terminalStatement(db, row.id, nowIso).run();
    return { ...base, outcome: "nodata" };
  }

  if (job.stage !== "ai") {
    const found = extractProgramText(page.text);
    if (found) {
      await outcomeStatement(db, row, found, now, nowIso, today).run();
      return { ...base, outcome: "filled" };
    }
    if (job.stage === "page") {
      const next = programLink(page.html, page.url);
      // 다음 단계는 이 행의 선점(15분)을 그대로 쓴다. 여기서 D1에 쓰지 않는 이유가
      // 그것이다 — 중간 상태를 만들면 다음 단계의 판정과 어긋난다.
      if (next) return { ...base, outcome: "handed_off", next: { stage: "subpage", id: row.id, url: next } };
    }
    if (env.AI) {
      return { ...base, outcome: "handed_off", next: { stage: "ai", id: row.id, url: page.url.href } };
    }
    await outcomeStatement(db, row, null, now, nowIso, today).run();
    return { ...base, outcome: hasEnded(row, today) ? "nodata" : "empty" };
  }

  base.llmCalls = 1;
  const extracted = await extractWithAi(env, row, page.text);
  if (extracted === "rejected") base.llmRejected = 1;
  const program = extracted === "rejected" ? null : extracted;
  await outcomeStatement(db, row, program, now, nowIso, today).run();
  if (program) return { ...base, outcome: "filled" };
  return { ...base, outcome: hasEnded(row, today) ? "nodata" : "empty" };
}

export function programCrawlBacklog(db: D1Database, now: Date = new Date()): Promise<number> {
  return backlog(db, seoulDayString(now));
}

/// 랜딩 페이지를 열고, 규칙이 빈손이면 프로그램처럼 보이는 링크 하나만 더 따라간다.
async function crawlRow(
  row: CrawlRow,
): Promise<{ program: string | null; text: string | null; pages: number }> {
  const landing = await fetchPageText(row.source_url ?? "");
  let pages = 1;
  const found = extractProgramText(landing.text);
  if (found) return { program: found, text: landing.text, pages };

  const next = programLink(landing.html, landing.url);
  if (!next) return { program: null, text: landing.text, pages };

  const sub = await fetchPageText(next);
  pages += 1;
  return {
    program: extractProgramText(sub.text),
    text: sub.text || landing.text,
    pages,
  };
}

async function fetchPageText(
  rawUrl: string,
): Promise<{ html: string; text: string; url: URL }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("program crawl NODATA: invalid url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("program crawl NODATA: unsupported scheme");
  }
  const response = await fetchWithTimeout(
    url,
    {
      // 공개 페이지를 있는 그대로 받는다. 봇 탐지 우회 헤더나 쿠키는 쓰지 않는다.
      // 다만 신원은 밝힌다: Workers fetch는 User-Agent를 붙이지 않는데,
      // suwon.go.kr 같은 지자체 사이트는 UA 없는 요청에 200으로 "보안 정책 차단 알림"
      // 1.2KB 페이지를 돌려준다(2026-09-02 실측). 그러면 본문이 없으니 매번 `empty`로
      // 재큐잉되며 영원히 같은 행을 다시 긁는다. 브라우저를 흉내내는 것이 아니라
      // 우리가 누구인지 적어 보낸다 — 같은 페이지가 이 UA로도 34KB 전문으로 온다.
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent":
          "ParkingLotNavigatorBot/1.0 (+https://parking-lot-navigator-api.parkingnav.workers.dev)",
      },
      redirect: "follow",
    },
    FETCH_TIMEOUT_MS,
  );
  if (!response.ok) {
    if (response.status === 429 || response.status >= 500) {
      throw new Error(`program crawl failed: ${response.status}`);
    }
    throw new Error(`program crawl NODATA: ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !/html|xml|text\/plain/i.test(contentType)) {
    throw new Error("program crawl NODATA: not a document");
  }
  const html = await readBoundedHtml(response);
  return { html, text: htmlToText(html), url: response.url ? new URL(response.url) : url };
}

/**
 * 본문을 상한까지만 읽고 나머지는 버린다. 예전에는 `response.text()`로 전문을
 * 메모리에 올린 뒤 잘랐는데, 34KB짜리 페이지가 아니라 수백KB짜리 지자체 페이지를
 * 만나면 자르기 전에 이미 디코딩 비용을 다 치른다 — 이 파이프라인에서 가장 비싼
 * CPU가 거기다. 상한에 닿으면 reader를 cancel해 나머지 바이트는 받지도 않는다.
 *
 * 단, `response.text()`는 Content-Type의 charset을 보고 디코딩한다. 한국 지자체
 * 페이지는 EUC-KR이 흔해서, 스트림을 UTF-8로 못 박아 읽으면 본문이 깨진다.
 * UTF-8이 아니라고 **선언한** 경우에만 예전 경로로 되돌린다.
 */
async function readBoundedHtml(response: Response): Promise<string> {
  const charset = /charset\s*=\s*"?([\w-]+)/i
    .exec(response.headers.get("content-type") ?? "")?.[1]
    ?.toLowerCase();
  const body = response.body;
  if (!body || (charset && charset !== "utf-8" && charset !== "utf8")) {
    return (await response.text()).slice(0, MAX_HTML_CHARS);
  }
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let html = "";
  try {
    while (html.length < MAX_HTML_CHARS) {
      const { done, value } = await reader.read();
      if (done) {
        html += decoder.decode();
        break;
      }
      html += decoder.decode(value, { stream: true });
    }
  } finally {
    // 상한에서 끊은 경우 남은 바이트를 받지 않는다. 이미 끝난 스트림이면 no-op.
    await reader.cancel().catch(() => {});
  }
  return html.length > MAX_HTML_CHARS ? html.slice(0, MAX_HTML_CHARS) : html;
}

/// 랜딩 페이지가 목록뿐일 때 프로그램 페이지로 들어가는 링크 하나. 같은 호스트만 따라간다.
export function programLink(html: string, base: URL): string | null {
  // 라벨을 lazy quantifier(`[\s\S]{0,200}?`)로 잡으면 닫히지 않은 앵커에서
  // 백트래킹이 폭발한다. 여는 태그만 정규식으로 찾고 라벨은 indexOf로 자른다.
  const anchor = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(anchor)) {
    const labelStart = (match.index ?? 0) + match[0].length;
    const close = html.indexOf("</a>", labelStart);
    if (close < 0) continue;
    const label = html
      .slice(labelStart, Math.min(close, labelStart + 200))
      .replace(/<[^>]+>/g, " ");
    if (!PROGRAM_HEADING.test(label)) continue;
    let candidate: URL;
    try {
      candidate = new URL(match[1], base);
    } catch {
      continue;
    }
    if (candidate.host !== base.host) continue;
    if (candidate.href === base.href) continue;
    if (candidate.protocol !== "http:" && candidate.protocol !== "https:") continue;
    return candidate.href;
  }
  return null;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|td|th)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

/**
 * 규칙 추출. 두 갈래만 본다 — 프로그램 제목 아래에 이어지는 줄, 그리고 시각 표기가
 * 있어 스스로 프로그램 한 줄임을 증명하는 줄. 어느 쪽도 없으면 null을 돌려 LLM에 넘긴다.
 */
export function extractProgramText(text: string): string | null {
  const lines = text.split("\n");
  const headingIndex = lines.findIndex((line) => line.length <= 40 && PROGRAM_HEADING.test(line));
  if (headingIndex >= 0) {
    const collected: string[] = [];
    for (const line of lines.slice(headingIndex + 1, headingIndex + 21)) {
      if (PROGRAM_STOP.test(line)) break;
      if (line.length <= 40 && PROGRAM_HEADING.test(line)) break;
      if (PROGRAM_SKIP_LINE.test(line)) continue;
      collected.push(line);
    }
    // 시각·날짜가 한 줄도 없으면 프로그램이 아니다. 줄 수만 세면 "예매안내 /
    // 관람안내 / 봄꽃축제 …" 같은 사이트 네비게이션 메뉴가 그대로 통과한다
    // (2026-09-02 영등포문화재단 행에서 실제로 그렇게 저장됐다).
    const meaningful = collected.filter((line) => line.length >= 4);
    if (meaningful.some((line) => TIME_LINE.test(line))) {
      return capProgram(meaningful.join("\n"));
    }
  }

  const timed = lines
    .filter((line) => TIME_LINE.test(line) && line.length >= 6 && !PROGRAM_SKIP_LINE.test(line))
    .slice(0, 12);
  if (timed.length >= 2) return capProgram(timed.join("\n"));
  return null;
}

function capProgram(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length < 8) return null;
  return trimmed.slice(0, MAX_PROGRAM_CHARS);
}

/**
 * 규칙이 못 뽑은 페이지만 LLM에 넘긴다. 모델은 **추출만** 한다 — 원문에 없는 문장을
 * 만들어 내면 근거 검사에서 통째로 버린다("rejected"). 없으면 없다고 두는 편이
 * 지어낸 프로그램을 앱에 띄우는 것보다 낫다.
 */
async function extractWithAi(
  env: ProgramCrawlEnv,
  row: CrawlRow,
  text: string,
): Promise<string | "rejected" | null> {
  if (!env.AI) return null;
  try {
    const parsed = await callAiJson<{ programInfo?: string | null }>({
      ai: env.AI,
      model: env.TAGGING_MODEL,
      jsonMode: true,
      maxOutputTokens: 512,
      systemInstruction:
        "너는 행사 웹페이지에서 프로그램·공연 일정만 그대로 옮겨 적는 추출기다. " +
        "본문에 문자 그대로 있는 문장만 사용한다. 요약·번역·추측·보완을 하지 않고, " +
        "출연자나 시간을 만들어 내지 않는다. 프로그램 일정이 본문에 없으면 반드시 null을 돌려준다. " +
        '출력은 {"programInfo": string|null} 형식의 JSON만.',
      prompt: `행사명: ${row.title ?? ""}\n\n본문:\n${text.slice(0, MAX_LLM_CHARS)}`,
    });
    const value = typeof parsed.programInfo === "string" ? parsed.programInfo.trim() : "";
    if (!value) return null;
    if (!isGrounded(value, text)) return "rejected";
    return capProgram(value);
  } catch (error) {
    console.warn(`program crawl llm failed id=${row.id}`, error);
    return null;
  }
}

/**
 * 근거 검사. LLM이 돌려준 각 줄이 원문에 실제로 있는지 본다. 공백·문장부호를 지운
 * 뒤 부분 문자열로 비교하므로 줄바꿈이나 들여쓰기 차이는 통과하지만, 없는 사실을
 * 지어내면 통과하지 못한다.
 */
export function isGrounded(value: string, source: string): boolean {
  const haystack = normalizeForGrounding(source);
  const lines = value
    .split("\n")
    .map((line) => normalizeForGrounding(line))
    .filter((line) => line.length >= 4);
  if (lines.length === 0) return false;
  return lines.every((line) => haystack.includes(line));
}

function normalizeForGrounding(value: string): string {
  return value.replace(/[\s~\-–—·•*_,.:;()[\]{}'"`]/g, "");
}

function outcomeStatement(
  db: D1Database,
  row: CrawlRow,
  program: string | null,
  now: Date,
  nowIso: string,
  today: string,
): D1PreparedStatement {
  if (program) {
    // raw_payload에도 심어야 다음 full sync의 enrichment 병합이 값을 살린다
    // (sync는 raw_payload를 통째로 덮어쓴다).
    return db
      .prepare(
        `UPDATE discovery_items
            SET raw_payload = CASE
                  WHEN json_valid(raw_payload)
                  THEN json_set(raw_payload, '$.programInfo', ?)
                  ELSE raw_payload
                END,
                program_filled_at = ?,
                program_checked_at = ?,
                detail_state = 'done',
                detail_retry_after = NULL
          WHERE id = ?`,
      )
      .bind(program, nowIso, nowIso, row.id);
  }
  if (hasEnded(row, today)) {
    return terminalStatement(db, row.id, nowIso);
  }
  return db
    .prepare(
      `UPDATE discovery_items
          SET detail_state = 'empty',
              detail_retry_after = ?,
              program_checked_at = ?
        WHERE id = ?`,
    )
    .bind(emptyRetryAfter(now, row, today), nowIso, row.id);
}

function terminalStatement(
  db: D1Database,
  id: string,
  nowIso: string,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE discovery_items
          SET detail_state = 'nodata',
              detail_retry_after = NULL,
              program_checked_at = ?
        WHERE id = ?`,
    )
    .bind(nowIso, id);
}

async function backlog(db: D1Database, today: string): Promise<number> {
  const placeholders = CRAWL_SOURCES.map(() => "?").join(",");
  const rows = await db
    .prepare(
      `SELECT COUNT(*) AS backlog
         FROM discovery_items
        WHERE source IN (${placeholders})
          AND program_filled_at IS NULL
          AND json_extract(raw_payload, '$.programInfo') IS NULL
          AND source_url IS NOT NULL
          AND source_url <> ''
          AND (end_date IS NULL OR end_date >= ?)
          AND (detail_state IS NULL OR detail_state <> 'nodata')`,
    )
    .bind(...CRAWL_SOURCES, today)
    .all<{ backlog: number | null }>();
  return rows.results?.[0]?.backlog ?? 0;
}

async function flush(
  db: D1Database,
  statements: D1PreparedStatement[],
): Promise<void> {
  for (let start = 0; start < statements.length; start += 50) {
    await db.batch(statements.slice(start, start + 50));
  }
}

/// 페이지는 열렸는데 프로그램이 아직 없는 행의 다음 확인 시각. 시작이 가까울수록 자주 본다.
function emptyRetryAfter(now: Date, row: CrawlRow, today: string): string {
  const days = daysUntil(row.start_date, today);
  if (days === null || days > 30) return plusMinutes(now, 7 * 24 * 60);
  if (days > 7) return plusMinutes(now, 2 * 24 * 60);
  return plusMinutes(now, 12 * 60);
}

function transientRetryAfter(now: Date, row: CrawlRow): string {
  const attempts = Math.max(1, row.detail_attempts ?? 1);
  const minutes = Math.min(
    TRANSIENT_BACKOFF_BASE_MINUTES * 2 ** (attempts - 1),
    TRANSIENT_BACKOFF_MAX_MINUTES,
  );
  return plusMinutes(now, minutes);
}

function hasEnded(row: CrawlRow, today: string): boolean {
  return Boolean(row.end_date && row.end_date < today);
}

function daysUntil(startDate: string | null, today: string): number | null {
  if (!startDate) return null;
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const base = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(base)) return null;
  return Math.round((start - base) / 86_400_000);
}

function plusMinutes(now: Date, minutes: number): string {
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
