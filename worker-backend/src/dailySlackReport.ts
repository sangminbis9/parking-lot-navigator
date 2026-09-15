import { seoulDayString } from "./kstDate.js";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const REPORT_STATE_PREFIX = "ops/daily-slack-report/";

export interface DailySlackReportEnv {
  DB?: D1Database;
  DISCOVERY_SNAPSHOTS?: R2Bucket;
  SLACK_DAILY_REPORT_WEBHOOK_URL?: string;
}

export interface DailySlackReportData {
  day: string;
  generatedAt: string;
  dailyActiveUsers: number;
  festivals: number;
  tradeExpos: number;
  performances: number;
  localEvents: number;
  merchantEventsTotal: number;
}

export interface DailySlackReportResult {
  sent: boolean;
  skipped?: "already_sent" | "webhook_not_configured";
  day: string;
  messages: number;
  merchantEvents: number;
}

interface CountRow extends Record<string, unknown> {
  count?: number | string;
  merchant_count?: number | string;
}

interface DiscoveryCountRow extends Record<string, unknown> {
  festivals?: number | string;
  trade_expos?: number | string;
  performances?: number | string;
}

type SlackBlock = Record<string, unknown>;
export interface SlackWebhookPayload {
  text: string;
  blocks: SlackBlock[];
}

function kstDayStart(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - KST_OFFSET_MS).toISOString();
}

function numberOf(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstRow<T extends Record<string, unknown>>(result: D1Result<T>): T | undefined {
  return result.results?.[0];
}

/** One indexed analytics lookup plus two intentionally small daily scans.
 * Adding first_seen/created_at indexes would amplify every collection write; at the
 * current ~12.7k discovery rows, one report scan per day is considerably cheaper. */
export async function queryDailySlackReport(
  db: D1Database,
  now: Date = new Date(),
): Promise<DailySlackReportData> {
  const day = seoulDayString(now);
  const from = kstDayStart(day);
  const until = now.toISOString();
  const [analytics, discovery, local] = await db.batch<CountRow | DiscoveryCountRow>([
    db.prepare(
      `SELECT count FROM analytics_daily
        WHERE day = ? AND event = 'app_open' AND label = '' LIMIT 1`,
    ).bind(day),
    db.prepare(
      `SELECT
         SUM(CASE WHEN primary_category = 'music_performance' OR source = 'kopis'
                  THEN 0 WHEN primary_category = 'trade_expo' OR source = 'akei-trade-expo'
                  THEN 0 ELSE 1 END) AS festivals,
         SUM(CASE WHEN primary_category = 'trade_expo' OR source = 'akei-trade-expo'
                  THEN 1 ELSE 0 END) AS trade_expos,
         SUM(CASE WHEN primary_category = 'music_performance' OR source = 'kopis'
                  THEN 1 ELSE 0 END) AS performances
       FROM discovery_items
       WHERE type = 'festival' AND first_seen_at >= ? AND first_seen_at < ?`,
    ).bind(from, until),
    db.prepare(
      `SELECT COUNT(*) AS count,
              SUM(CASE WHEN source = 'merchant' THEN 1 ELSE 0 END) AS merchant_count
       FROM local_events
       WHERE created_at >= ? AND created_at < ?`,
    ).bind(from, until),
  ]);

  const localCounts = firstRow(local as D1Result<CountRow>);
  const merchantEventsTotal = numberOf(localCounts?.merchant_count);
  const discoveryCounts = firstRow(discovery as D1Result<DiscoveryCountRow>);
  return {
    day,
    generatedAt: until,
    dailyActiveUsers: numberOf(firstRow(analytics as D1Result<CountRow>)?.count),
    festivals: numberOf(discoveryCounts?.festivals),
    tradeExpos: numberOf(discoveryCounts?.trade_expos),
    performances: numberOf(discoveryCounts?.performances),
    localEvents: numberOf(localCounts?.count),
    merchantEventsTotal,
  };
}

export function slackText(value: string | null | undefined, fallback = "-"): string {
  const text = value?.trim() || fallback;
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function clipped(value: string | null | undefined, limit: number, fallback = "-"): string {
  const safe = slackText(value, fallback);
  return safe.length > limit ? `${safe.slice(0, limit - 1)}…` : safe;
}

export function statusLabel(value: string): string {
  return ({ pending: "검토 대기", pending_payment: "결제 대기", approved: "승인",
    rejected: "반려", expired: "종료" } as Record<string, string>)[value] ?? value;
}

export function eventTypeLabel(value: string): string {
  return ({ discount: "할인", freebie: "증정", review_event: "리뷰 이벤트", popup: "팝업",
    limited_menu: "한정 메뉴", opening_event: "오픈 이벤트", etc: "기타" } as Record<string, string>)[value] ?? value;
}

export function formatKstTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

export function buildDailySlackPayloads(data: DailySlackReportData): SlackWebhookPayload[] {
  const summary = [
    `*📊 ${data.day} 이벤트다 일일 통계 (${slackText(formatKstTime(data.generatedAt))} KST 기준)*`,
    `• 하루 접속자: *${data.dailyActiveUsers.toLocaleString("ko-KR")}명* (설치별 하루 1회 익명 집계)`,
    `• 새 축제: *${data.festivals.toLocaleString("ko-KR")}개*`,
    `• 새 박람회: *${data.tradeExpos.toLocaleString("ko-KR")}개*`,
    `• 새 공연: *${data.performances.toLocaleString("ko-KR")}개*`,
    `• 새 로컬 이벤트: *${data.localEvents.toLocaleString("ko-KR")}개*`,
    `• 사장님 직접 등록: *${data.merchantEventsTotal.toLocaleString("ko-KR")}개*`,
  ].join("\n");
  return [{
    text: `${data.day} 이벤트다 일일 통계`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: summary } },
      { type: "context", elements: [{ type: "mrkdwn", text: `생성 시각 ${slackText(formatKstTime(data.generatedAt))}` }] },
    ],
  }];
}

export function validateSlackWebhook(value: string): string {
  const url = new URL(value);
  const validHost = url.hostname === "hooks.slack.com" || url.hostname === "hooks.slack-gov.com";
  if (url.protocol !== "https:" || !validHost || !url.pathname.startsWith("/services/")) {
    throw new Error("invalid_slack_webhook_url");
  }
  return url.toString();
}

export async function sendDailySlackReport(
  env: DailySlackReportEnv,
  options: { now?: Date; force?: boolean; fetcher?: typeof fetch } = {},
): Promise<DailySlackReportResult> {
  if (!env.DB || !env.DISCOVERY_SNAPSHOTS) throw new Error("daily_report_bindings_not_configured");
  const now = options.now ?? new Date();
  const day = seoulDayString(now);
  if (!env.SLACK_DAILY_REPORT_WEBHOOK_URL) {
    return { sent: false, skipped: "webhook_not_configured", day, messages: 0, merchantEvents: 0 };
  }
  const webhook = validateSlackWebhook(env.SLACK_DAILY_REPORT_WEBHOOK_URL);
  const stateKey = `${REPORT_STATE_PREFIX}${day}.json`;
  if (!options.force && await env.DISCOVERY_SNAPSHOTS.head(stateKey)) {
    return { sent: false, skipped: "already_sent", day, messages: 0, merchantEvents: 0 };
  }
  // Retry invocations at 20:10/20:20 must reproduce the 20:00 report instead of
  // moving the cutoff. A forced admin preview always uses its actual call time.
  const scheduledCutoff = new Date(`${day}T11:00:00.000Z`);
  const reportCutoff = !options.force && now >= scheduledCutoff ? scheduledCutoff : now;
  const data = await queryDailySlackReport(env.DB, reportCutoff);
  const payloads = buildDailySlackPayloads(data);
  const fetcher = options.fetcher ?? fetch;
  for (const payload of payloads) {
    const response = await fetcher(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`slack_webhook_failed:${response.status}`);
  }
  await env.DISCOVERY_SNAPSHOTS.put(stateKey, JSON.stringify({
    schemaVersion: 1, day, sentAt: now.toISOString(), messages: payloads.length,
    merchantEvents: data.merchantEventsTotal,
  }), { httpMetadata: { contentType: "application/json" } });
  console.log(JSON.stringify({ event: "daily_slack_report_sent", day,
    messages: payloads.length, merchantEvents: data.merchantEventsTotal }));
  return { sent: true, day, messages: payloads.length, merchantEvents: data.merchantEventsTotal };
}
