import {
  clipped,
  eventTypeLabel,
  formatKstTime,
  slackText,
  statusLabel,
  validateSlackWebhook,
  type SlackWebhookPayload,
} from "../dailySlackReport.js";
import { getMerchantEventById, type MerchantEventRow } from "./events.js";

const STATE_PREFIX = "ops/merchant-event-slack/";

export interface MerchantEventSlackEnv {
  DB?: D1Database;
  DISCOVERY_SNAPSHOTS?: R2Bucket;
  SLACK_DAILY_REPORT_WEBHOOK_URL?: string;
}

export type MerchantEventSlackResult = {
  sent: boolean;
  skipped?: "webhook_not_configured" | "already_sent";
};

function safeHttpsUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function buildMerchantEventCreatedPayload(event: MerchantEventRow): SlackWebhookPayload {
  const period = event.start_date || event.end_date
    ? `${event.start_date ?? "미정"} ~ ${event.end_date ?? "미정"}`
    : "미정 (등록 완료 시 게시 기간 확정)";
  const couponUrl = safeHttpsUrl(event.source_url);
  const imageUrl = safeHttpsUrl(event.image_url);
  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: { type: "plain_text", text: "🏪 사장님 이벤트 신규 등록", emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*${clipped(event.store_name, 100)} · ${clipped(event.title, 150)}*`,
          `상태: ${slackText(statusLabel(event.status))}  |  유형: ${slackText(eventTypeLabel(event.event_type))}`,
          `등록: ${slackText(formatKstTime(event.created_at))}`,
          `기간: ${slackText(period)}`,
          `주소: ${clipped(event.address, 250)}`,
          `혜택: ${clipped(event.benefit, 350)}`,
          `설명: ${clipped(event.description, 800)}`,
          `쿠폰 링크: ${couponUrl ? "등록됨" : "없음"}`,
          `대표 이미지: ${imageUrl ? "등록됨" : "없음"}`,
        ].join("\n"),
      },
    },
  ];
  if (couponUrl) {
    blocks.push({
      type: "actions",
      elements: [{
        type: "button",
        text: { type: "plain_text", text: "네이버 쿠폰 열기" },
        url: couponUrl,
      }],
    });
  }
  if (imageUrl) {
    blocks.push({
      type: "image",
      image_url: imageUrl,
      alt_text: clipped(event.title, 100),
      title: { type: "plain_text", text: "등록된 대표 이미지" },
    });
  }
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `이벤트 ID: \`${slackText(event.id)}\`` }],
  });
  return {
    text: `사장님 이벤트 신규 등록: ${event.store_name} · ${event.title}`,
    blocks,
  };
}

export async function sendMerchantEventCreatedSlack(
  env: MerchantEventSlackEnv,
  eventId: string,
  fetcher: typeof fetch = fetch,
): Promise<MerchantEventSlackResult> {
  if (!env.DB) throw new Error("merchant_slack_db_not_configured");
  const event = await getMerchantEventById(env.DB, eventId);
  if (!event || event.source !== "merchant") throw new Error("merchant_event_not_found");
  return sendMerchantEventCreatedSlackCard(env, event, fetcher);
}

export async function sendMerchantEventCreatedSlackCard(
  env: MerchantEventSlackEnv,
  event: MerchantEventRow,
  fetcher: typeof fetch = fetch,
): Promise<MerchantEventSlackResult> {
  if (!env.SLACK_DAILY_REPORT_WEBHOOK_URL) {
    return { sent: false, skipped: "webhook_not_configured" };
  }
  if (event.source !== "merchant") throw new Error("merchant_event_not_found");
  const stateKey = `${STATE_PREFIX}${event.id}.json`;
  if (env.DISCOVERY_SNAPSHOTS) {
    try {
      if (await env.DISCOVERY_SNAPSHOTS.head(stateKey)) {
        return { sent: false, skipped: "already_sent" };
      }
    } catch (error) {
      console.warn("merchant Slack dedupe check failed", error);
    }
  }
  const response = await fetcher(validateSlackWebhook(env.SLACK_DAILY_REPORT_WEBHOOK_URL), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildMerchantEventCreatedPayload(event)),
  });
  if (!response.ok) throw new Error(`slack_webhook_failed:${response.status}`);
  if (env.DISCOVERY_SNAPSHOTS) {
    try {
      await env.DISCOVERY_SNAPSHOTS.put(stateKey, JSON.stringify({
        schemaVersion: 1,
        eventId: event.id,
        sentAt: new Date().toISOString(),
      }), { httpMetadata: { contentType: "application/json" } });
    } catch (error) {
      // Slack already accepted the message. Do not retry and risk a duplicate solely
      // because the optional dedupe marker could not be written.
      console.warn("merchant Slack dedupe marker failed", error);
    }
  }
  console.log(JSON.stringify({ event: "merchant_event_slack_sent", eventId: event.id }));
  return { sent: true };
}
