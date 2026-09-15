import { seoulDayString } from "./kstDate.js";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MAX_MERCHANT_EVENTS = 2000;
const FIRST_MESSAGE_CARD_LIMIT = 44;
const FOLLOWUP_MESSAGE_CARD_LIMIT = 47;
const REPORT_STATE_PREFIX = "ops/daily-slack-report/";

export interface DailySlackReportEnv {
  DB?: D1Database;
  DISCOVERY_SNAPSHOTS?: R2Bucket;
  SLACK_DAILY_REPORT_WEBHOOK_URL?: string;
}

export interface MerchantEventCard {
  id: string;
  title: string;
  description: string | null;
  benefit: string | null;
  eventType: string;
  status: string;
  storeName: string;
  address: string;
  startDate: string | null;
  endDate: string | null;
  imageUrl: string | null;
  createdAt: string;
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
  merchantEvents: MerchantEventCard[];
  merchantEventsTruncated: number;
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

interface MerchantEventRow extends Record<string, unknown> {
  id: string;
  title: string;
  description: string | null;
  benefit: string | null;
  event_type: string;
  status: string;
  store_name: string;
  address: string;
  start_date: string | null;
  end_date: string | null;
  image_url: string | null;
  created_at: string;
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
  const [analytics, discovery, local, merchants] = await db.batch<CountRow | DiscoveryCountRow | MerchantEventRow>([
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
    db.prepare(
      `SELECT id, title, description, benefit, event_type, status, store_name,
              address, start_date, end_date, image_url, created_at
       FROM local_events
       WHERE source = 'merchant' AND created_at >= ? AND created_at < ?
       ORDER BY created_at ASC, id ASC
       LIMIT ?`,
    ).bind(from, until, MAX_MERCHANT_EVENTS + 1),
  ]);

  const merchantRows = (merchants.results ?? []) as MerchantEventRow[];
  const localCounts = firstRow(local as D1Result<CountRow>);
  const merchantEventsTotal = numberOf(localCounts?.merchant_count);
  const truncated = Math.max(0, merchantEventsTotal - MAX_MERCHANT_EVENTS);
  const visibleMerchantRows = merchantRows.slice(0, MAX_MERCHANT_EVENTS);
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
    merchantEvents: visibleMerchantRows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      description: row.description == null ? null : String(row.description),
      benefit: row.benefit == null ? null : String(row.benefit),
      eventType: String(row.event_type),
      status: String(row.status),
      storeName: String(row.store_name),
      address: String(row.address),
      startDate: row.start_date == null ? null : String(row.start_date),
      endDate: row.end_date == null ? null : String(row.end_date),
      imageUrl: row.image_url == null ? null : String(row.image_url),
      createdAt: String(row.created_at),
    })),
    merchantEventsTruncated: truncated,
  };
}

function slackText(value: string | null | undefined, fallback = "-"): string {
  const text = value?.trim() || fallback;
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function clipped(value: string | null | undefined, limit: number, fallback = "-"): string {
  const safe = slackText(value, fallback);
  return safe.length > limit ? `${safe.slice(0, limit - 1)}…` : safe;
}

function statusLabel(value: string): string {
  return ({ pending: "검토 대기", pending_payment: "결제 대기", approved: "승인",
    rejected: "반려", expired: "종료" } as Record<string, string>)[value] ?? value;
}

function eventTypeLabel(value: string): string {
  return ({ discount: "할인", freebie: "증정", review_event: "리뷰 이벤트", popup: "팝업",
    limited_menu: "한정 메뉴", opening_event: "오픈 이벤트", etc: "기타" } as Record<string, string>)[value] ?? value;
}

function merchantCard(event: MerchantEventCard): SlackBlock {
  const period = event.startDate || event.endDate
    ? `${event.startDate ?? "미정"} ~ ${event.endDate ?? "미정"}` : "미정";
  const text = [
    `*${clipped(event.storeName, 100)} · ${clipped(event.title, 150)}*`,
    `상태: ${slackText(statusLabel(event.status))}  |  유형: ${slackText(eventTypeLabel(event.eventType))}`,
    `기간: ${slackText(period)}  |  등록: ${slackText(formatKstTime(event.createdAt))}`,
    `주소: ${clipped(event.address, 250)}`,
    `혜택: ${clipped(event.benefit, 350)}`,
    `설명: ${clipped(event.description, 800)}`,
  ].join("\n");
  const block: SlackBlock = { type: "section", text: { type: "mrkdwn", text } };
  if (event.imageUrl && /^https:\/\//i.test(event.imageUrl)) {
    block.accessory = { type: "image", image_url: event.imageUrl, alt_text: clipped(event.title, 100) };
  }
  return block;
}

function formatKstTime(value: string): string {
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
  const blocks: SlackBlock[] = [
    { type: "section", text: { type: "mrkdwn", text: summary } },
    { type: "context", elements: [{ type: "mrkdwn", text: `생성 시각 ${slackText(formatKstTime(data.generatedAt))}` }] },
  ];
  const payloads: SlackWebhookPayload[] = [];
  const firstEvents = data.merchantEvents.slice(0, FIRST_MESSAGE_CARD_LIMIT);
  if (firstEvents.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push(...firstEvents.map(merchantCard));
  }
  if (data.merchantEventsTruncated > 0) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `⚠️ 안전 상한을 넘은 ${data.merchantEventsTruncated}개는 생략됨` }] });
  }
  payloads.push({ text: `${data.day} 이벤트다 일일 통계`, blocks });

  let offset = FIRST_MESSAGE_CARD_LIMIT;
  while (offset < data.merchantEvents.length) {
    const page = data.merchantEvents.slice(offset, offset + FOLLOWUP_MESSAGE_CARD_LIMIT);
    payloads.push({
      text: `${data.day} 사장님 등록 이벤트 상세`,
      blocks: [
        { type: "header", text: { type: "plain_text", text: `사장님 등록 이벤트 ${offset + 1}–${offset + page.length}` } },
        ...page.map(merchantCard),
      ],
    });
    offset += page.length;
  }
  return payloads;
}

function validateWebhook(value: string): string {
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
  const webhook = validateWebhook(env.SLACK_DAILY_REPORT_WEBHOOK_URL);
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
