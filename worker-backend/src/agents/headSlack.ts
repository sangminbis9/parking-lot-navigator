import {
  clipped,
  eventTypeLabel,
  formatKstTime,
  slackText,
  statusLabel,
  validateSlackWebhook,
  type SlackWebhookPayload,
} from "../dailySlackReport.js";
import { getMerchantEventById, type MerchantEventRow } from "../merchant/events.js";
import { timingSafeStringEqual } from "../security.js";
import { logAgentActivity, type HeadVerdict } from "./headAgent.js";

export const HEAD_SLACK_APPROVE = "head_approve";
export const HEAD_SLACK_REJECT = "head_reject";
const ADMIN_REJECT_REASON = "관리자 Slack 거절";
const SIGNATURE_MAX_AGE_SEC = 300;

export interface HeadSlackEnv {
  SLACK_DAILY_REPORT_WEBHOOK_URL?: string;
  SLACK_SIGNING_SECRET?: string;
}

/** 입력된 필드를 전부 싣는다. 사장님 연락처는 merchants에만 있고 여기 row에 없다. */
export function buildHeadReviewCard(
  event: MerchantEventRow,
  verdict: Pick<HeadVerdict, "verdict" | "reason">,
  decision?: string,
): SlackWebhookPayload {
  const label = decision ? "📝 처리 완료" : verdict.verdict === "reject" ? "🚫 Head 반려" : "⏸️ Head 보류";
  const period = `${event.start_date ?? "미정"} ~ ${event.end_date ?? "미정"}`;
  const blocks: Array<Record<string, unknown>> = [
    { type: "header", text: { type: "plain_text", text: label, emoji: true } },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*${clipped(event.store_name, 100)} · ${clipped(event.title, 150)}*`,
          `AI 사유: ${clipped(verdict.reason, 200)}`,
          `현재 상태: ${slackText(statusLabel(event.status))}  |  유형: ${slackText(eventTypeLabel(event.event_type))}  |  출처: ${slackText(event.source)}`,
          `기간: ${slackText(period)}`,
          `주소: ${clipped(event.address, 250)}`,
          `좌표: ${event.lat != null && event.lng != null ? `${event.lat}, ${event.lng}` : "없음"}`,
          `혜택: ${clipped(event.benefit, 350)}`,
          `설명: ${clipped(event.description, 800)}`,
          `링크: ${clipped(event.source_url, 300)}`,
          `대표 이미지: ${clipped(event.image_url, 300)}`,
          `게시 만료: ${slackText(event.paid_until)}  |  결제: ${slackText(event.payment_amount?.toString())}`,
          `이전 반려 사유: ${clipped(event.rejection_reason, 200)}`,
          `등록: ${slackText(formatKstTime(event.created_at))}  |  수정: ${slackText(formatKstTime(event.updated_at))}`,
        ].join("\n"),
      },
    },
  ];
  if (decision) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: decision } });
  } else {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: HEAD_SLACK_APPROVE,
          style: "primary",
          text: { type: "plain_text", text: "승인" },
          value: event.id,
        },
        {
          type: "button",
          action_id: HEAD_SLACK_REJECT,
          style: "danger",
          text: { type: "plain_text", text: "거절" },
          value: event.id,
        },
      ],
    });
  }
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `이벤트 ID: \`${slackText(event.id)}\`` }],
  });
  return { text: `${label}: ${event.store_name} · ${event.title}`, blocks };
}

/** best-effort. 실패해도 Head 심사 결과를 되돌리지 않는다. */
export async function sendHeadReviewSlack(
  db: D1Database,
  env: HeadSlackEnv,
  eventId: string,
  verdict: Pick<HeadVerdict, "verdict" | "reason">,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (!env.SLACK_DAILY_REPORT_WEBHOOK_URL) return false;
  try {
    const event = await getMerchantEventById(db, eventId);
    if (!event) return false;
    const response = await fetcher(validateSlackWebhook(env.SLACK_DAILY_REPORT_WEBHOOK_URL), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildHeadReviewCard(event, verdict)),
    });
    return response.ok;
  } catch (error) {
    console.warn("head review slack failed", error instanceof Error ? error.message : error);
    return false;
  }
}

async function verifySlackSignature(
  secret: string,
  timestamp: string | null,
  signature: string | null,
  rawBody: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > SIGNATURE_MAX_AGE_SEC) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`v0:${timestamp}:${rawBody}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeStringEqual(`v0=${hex}`, signature);
}

type SlackActionPayload = {
  type?: string;
  user?: { username?: string; name?: string };
  actions?: Array<{ action_id?: string; value?: string }>;
  response_url?: string;
};

/** Slack Interactivity 요청(승인/거절 버튼). 서명 검증 후 local_events.status를 바꾼다. */
export async function handleHeadSlackInteraction(
  db: D1Database,
  env: HeadSlackEnv,
  request: Request,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  if (!env.SLACK_SIGNING_SECRET) return new Response("slack_signing_secret_not_configured", { status: 503 });
  const raw = await request.text();
  const ok = await verifySlackSignature(
    env.SLACK_SIGNING_SECRET,
    request.headers.get("x-slack-request-timestamp"),
    request.headers.get("x-slack-signature"),
    raw,
  );
  if (!ok) return new Response("invalid_signature", { status: 401 });

  let payload: SlackActionPayload;
  try {
    payload = JSON.parse(new URLSearchParams(raw).get("payload") ?? "") as SlackActionPayload;
  } catch {
    return new Response("invalid_payload", { status: 400 });
  }
  const action = payload.actions?.[0];
  const eventId = action?.value;
  if (payload.type !== "block_actions" || !eventId ||
    (action?.action_id !== HEAD_SLACK_APPROVE && action?.action_id !== HEAD_SLACK_REJECT)) {
    return new Response(null, { status: 200 });
  }
  const approve = action.action_id === HEAD_SLACK_APPROVE;
  const who = slackText(payload.user?.username ?? payload.user?.name, "관리자");

  const event = await getMerchantEventById(db, eventId);
  let outcome: string;
  if (!event) {
    outcome = "⚠️ 이벤트를 찾을 수 없습니다.";
  } else if (event.status !== "pending" && event.status !== "rejected") {
    // pending_payment·expired·이미 승인된 행은 버튼으로 건드리지 않는다.
    outcome = `⚠️ 현재 상태(${slackText(statusLabel(event.status))})에서는 처리할 수 없습니다.`;
  } else {
    const now = new Date().toISOString();
    const result = await db
      .prepare(
        approve
          ? `UPDATE local_events
                SET status = 'approved', rejection_reason = NULL,
                    approved_at = COALESCE(approved_at, ?), updated_at = ?
              WHERE id = ? AND status IN ('pending', 'rejected')`
          : `UPDATE local_events
                SET status = 'rejected', rejection_reason = ?, approved_at = NULL, updated_at = ?
              WHERE id = ? AND status IN ('pending', 'rejected')`,
      )
      .bind(approve ? now : ADMIN_REJECT_REASON, now, eventId)
      .run();
    if ((result.meta?.changes ?? 0) > 0) {
      // Head가 사람 결정을 다음 회차에 되돌리지 않도록 남기는 표식이다(headAgent 후보 쿼리가 본다).
      await logAgentActivity(db, {
        agentId: "admin",
        action: approve ? "slack_approve" : "slack_reject",
        targetKind: "local_event",
        targetId: eventId,
        targetTitle: event.title,
        reason: who,
      });
      outcome = approve ? `✅ *${who}* 님이 승인했습니다.` : `🚫 *${who}* 님이 거절했습니다.`;
    } else {
      outcome = "⚠️ 이미 다른 경로로 처리되었습니다.";
    }
  }

  const latest = event ? await getMerchantEventById(db, eventId) : null;
  if (payload.response_url && latest) {
    try {
      const url = new URL(payload.response_url);
      if (url.protocol === "https:" && url.hostname === "hooks.slack.com") {
        await fetcher(url.toString(), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            replace_original: true,
            ...buildHeadReviewCard(latest, { verdict: "pending", reason: "-" }, outcome),
          }),
        });
      }
    } catch (error) {
      console.warn("head slack response_url failed", error instanceof Error ? error.message : error);
    }
  }
  return new Response(null, { status: 200 });
}
