import type { MerchantRow } from "./store.js";
import type {
  MerchantEventRow,
  MerchantEventStatus,
  MerchantEventType,
} from "./events.js";

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const baseStyle = `
  *, *::before, *::after { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Apple SD Gothic Neo", sans-serif; margin: 0; background: #f7f8fa; color: #1f2329; }
  .container { max-width: 480px; margin: 0 auto; padding: 24px 20px 80px; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  h2 { font-size: 18px; margin: 0 0 8px; }
  p { line-height: 1.55; margin: 0 0 12px; color: #4b5563; }
  label { display: block; font-size: 13px; font-weight: 600; color: #1f2329; margin: 14px 0 6px; }
  input, textarea, select { width: 100%; padding: 12px 14px; border-radius: 10px; border: 1px solid #d1d5db; background: #fff; font-size: 15px; color: #1f2329; font-family: inherit; }
  textarea { resize: vertical; min-height: 96px; }
  .field-help { font-size: 12px; color: #6b7280; margin-top: 4px; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; margin-bottom: 14px; }
  .btn { display: block; width: 100%; padding: 14px 16px; border-radius: 10px; border: 0; font-size: 16px; font-weight: 600; cursor: pointer; text-align: center; text-decoration: none; margin-top: 16px; box-sizing: border-box; }
  .btn-naver { background: #03c75a; color: #fff; }
  .btn-kakao { background: #fee500; color: #1f2329; }
  .btn-primary { background: #2563eb; color: #fff; }
  .btn-link { background: #1f2329; color: #fff; }
  .btn-secondary { background: #f3f4f6; color: #1f2329; }
  .muted { color: #6b7280; font-size: 13px; }
  .topbar { display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; background: #fff; border-bottom: 1px solid #e5e7eb; }
  .topbar h2 { font-size: 16px; margin: 0; }
  form.inline { display: inline; }
  form.inline button { border: 0; background: none; color: #6b7280; font-size: 13px; cursor: pointer; padding: 0; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; margin-left: 6px; vertical-align: middle; }
  .badge-approved { background: #d1fae5; color: #047857; }
  .badge-pending { background: #fef3c7; color: #92400e; }
  .badge-expired { background: #e5e7eb; color: #4b5563; }
  .badge-rejected { background: #fee2e2; color: #b91c1c; }
  .event-row { padding: 14px 0; border-top: 1px solid #f3f4f6; }
  .event-row:first-child { border-top: 0; }
  .event-title { font-weight: 600; font-size: 15px; margin-bottom: 2px; }
  .event-meta { font-size: 12px; color: #6b7280; }
  .error-banner { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; padding: 10px 12px; border-radius: 8px; font-size: 13px; margin-bottom: 12px; }
`;

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${htmlEscape(title)}</title>
  <style>${baseStyle}</style>
</head>
<body>
${body}
</body>
</html>`;
}

export function renderLanding(opts: {
  naverEnabled: boolean;
  kakaoEnabled: boolean;
}): string {
  const buttons: string[] = [];
  if (opts.naverEnabled) {
    buttons.push(
      `<a class="btn btn-naver" href="/merchant/auth/naver">네이버로 시작하기</a>`,
    );
  }
  if (opts.kakaoEnabled) {
    buttons.push(
      `<a class="btn btn-kakao" href="/merchant/auth/kakao">카카오로 시작하기</a>`,
    );
  }
  if (buttons.length === 0) {
    buttons.push(
      `<p class="muted">로그인 제공자가 아직 구성되지 않았습니다.</p>`,
    );
  }
  return layout(
    "사업자 이벤트 등록",
    `
<div class="container">
  <div class="card">
    <h1>내 가게 이벤트 홍보</h1>
    <p>3개월 게시 ₩10,000. 등록한 이벤트는 앱 지도와 리스트에 노출됩니다.</p>
    ${buttons.join("\n    ")}
  </div>
</div>
`,
  );
}

function statusBadge(status: MerchantEventStatus): string {
  switch (status) {
    case "approved":
      return `<span class="badge badge-approved">게시 중</span>`;
    case "pending_payment":
      return `<span class="badge badge-pending">결제 대기</span>`;
    case "pending":
      return `<span class="badge badge-pending">검수 대기</span>`;
    case "expired":
      return `<span class="badge badge-expired">만료</span>`;
    case "rejected":
      return `<span class="badge badge-rejected">반려</span>`;
  }
}

function eventRow(event: MerchantEventRow): string {
  const meta: string[] = [];
  meta.push(htmlEscape(event.store_name));
  if (event.paid_until) meta.push(`~ ${htmlEscape(event.paid_until)}`);
  else if (event.end_date) meta.push(`종료 ${htmlEscape(event.end_date)}`);
  const actionHref =
    event.status === "pending_payment"
      ? `/merchant/event/${event.id}/pay`
      : `/merchant/event/${event.id}`;
  const actionLabel =
    event.status === "pending_payment" ? "결제 계속하기" : "상세 보기";
  return `<div class="event-row">
    <div class="event-title">${htmlEscape(event.title)}${statusBadge(event.status)}</div>
    <div class="event-meta">${meta.join(" · ")}</div>
    <a class="muted" href="${actionHref}">${actionLabel} →</a>
  </div>`;
}

export function renderDashboard(
  merchant: MerchantRow,
  events: MerchantEventRow[],
): string {
  const name = merchant.display_name ?? "사업자";
  const eventList = events.length
    ? events.map(eventRow).join("\n")
    : `<p class="muted">등록한 이벤트가 없습니다. 첫 이벤트를 등록해 보세요.</p>`;
  return layout(
    "대시보드",
    `
<div class="topbar">
  <h2>${htmlEscape(name)} 님</h2>
  <form method="post" action="/merchant/logout" class="inline">
    <button type="submit">로그아웃</button>
  </form>
</div>
<div class="container">
  <div class="card">
    <h1>등록한 이벤트</h1>
    ${eventList}
    <a class="btn btn-link" href="/merchant/event/new">새 이벤트 등록</a>
  </div>
</div>
`,
  );
}

const EVENT_TYPE_OPTIONS: Array<[MerchantEventType, string]> = [
  ["discount", "할인"],
  ["freebie", "무료/증정"],
  ["review_event", "리뷰 이벤트"],
  ["popup", "팝업"],
  ["limited_menu", "한정 메뉴"],
  ["opening_event", "오픈 이벤트"],
  ["etc", "기타"],
];

export type EventFormValues = {
  title: string;
  description: string;
  benefit: string;
  eventType: MerchantEventType;
  storeName: string;
  address: string;
  startDate: string;
  endDate: string;
};

export const EMPTY_FORM: EventFormValues = {
  title: "",
  description: "",
  benefit: "",
  eventType: "discount",
  storeName: "",
  address: "",
  startDate: "",
  endDate: "",
};

export function renderEventForm(opts: {
  values: EventFormValues;
  error?: string;
}): string {
  const v = opts.values;
  const options = EVENT_TYPE_OPTIONS.map(
    ([key, label]) =>
      `<option value="${key}"${v.eventType === key ? " selected" : ""}>${htmlEscape(label)}</option>`,
  ).join("");
  const errorBanner = opts.error
    ? `<div class="error-banner">${htmlEscape(opts.error)}</div>`
    : "";
  return layout(
    "이벤트 등록",
    `
<div class="topbar">
  <h2>새 이벤트</h2>
  <a class="muted" href="/merchant/dashboard">취소</a>
</div>
<div class="container">
  <div class="card">
    ${errorBanner}
    <form method="post" action="/merchant/event/new" enctype="multipart/form-data">
      <label>이벤트 제목 *</label>
      <input name="title" required maxlength="80" value="${htmlEscape(v.title)}" placeholder="예: 첫 방문 시 음료 1잔 무료" />

      <label>혜택 요약 *</label>
      <input name="benefit" required maxlength="60" value="${htmlEscape(v.benefit)}" placeholder="예: 음료 1잔 무료, 10% 할인" />

      <label>이벤트 유형 *</label>
      <select name="event_type">${options}</select>

      <label>상세 설명 *</label>
      <textarea name="description" required maxlength="500" placeholder="이벤트 내용, 참여 조건, 주의사항">${htmlEscape(v.description)}</textarea>

      <label>매장명 *</label>
      <input name="store_name" required maxlength="60" value="${htmlEscape(v.storeName)}" placeholder="예: 동네카페 망원점" />

      <label>매장 주소 *</label>
      <input name="address" required maxlength="120" value="${htmlEscape(v.address)}" placeholder="도로명 또는 지번 주소" />
      <div class="field-help">주소로 지도 위치가 자동 설정됩니다.</div>

      <label>시작일</label>
      <input name="start_date" type="date" value="${htmlEscape(v.startDate)}" />
      <div class="field-help">비워두면 결제 완료 시점부터 시작합니다.</div>

      <label>종료일</label>
      <input name="end_date" type="date" value="${htmlEscape(v.endDate)}" />
      <div class="field-help">비워두면 결제 후 3개월간 게시됩니다.</div>

      <label>대표 이미지</label>
      <input name="image" type="file" accept="image/jpeg,image/png,image/webp" />
      <div class="field-help">JPG/PNG/WebP, 최대 5MB. 선택 사항.</div>

      <button class="btn btn-primary" type="submit">결제 단계로 이동</button>
    </form>
    <p class="muted" style="margin-top: 12px;">₩10,000 결제가 완료되면 3개월간 앱에 노출됩니다.</p>
  </div>
</div>
`,
  );
}

export function renderPaymentPlaceholder(event: MerchantEventRow): string {
  return layout(
    "결제",
    `
<div class="topbar">
  <h2>결제</h2>
  <a class="muted" href="/merchant/dashboard">대시보드</a>
</div>
<div class="container">
  <div class="card">
    <h1>${htmlEscape(event.title)}</h1>
    <p class="muted">${htmlEscape(event.store_name)} · ${htmlEscape(event.address)}</p>
    <p>3개월 게시 요금 <strong>₩10,000</strong></p>
    <p class="muted">결제 모듈 연결 작업이 진행 중입니다. 곧 이 화면에서 카드/카카오페이로 결제할 수 있게 됩니다.</p>
    <a class="btn btn-secondary" href="/merchant/dashboard">대시보드로 돌아가기</a>
  </div>
</div>
`,
  );
}

export function renderMessage(title: string, message: string): string {
  return layout(
    title,
    `
<div class="container">
  <div class="card">
    <h1>${htmlEscape(title)}</h1>
    <p>${htmlEscape(message)}</p>
    <a class="btn btn-secondary" href="/merchant">처음으로</a>
  </div>
</div>
`,
  );
}
