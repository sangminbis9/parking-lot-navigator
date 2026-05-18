import type { MerchantRow } from "./store.js";

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
  .container { max-width: 480px; margin: 0 auto; padding: 32px 20px; }
  h1 { font-size: 24px; margin: 0 0 8px; }
  p { line-height: 1.55; margin: 0 0 12px; color: #4b5563; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; }
  .btn { display: block; width: 100%; padding: 14px 16px; border-radius: 10px; border: 0; font-size: 16px; font-weight: 600; cursor: pointer; text-align: center; text-decoration: none; margin-top: 12px; }
  .btn-naver { background: #03c75a; color: #fff; }
  .btn-kakao { background: #fee500; color: #1f2329; }
  .btn-link { background: #1f2329; color: #fff; }
  .btn-secondary { background: #f3f4f6; color: #1f2329; }
  .muted { color: #6b7280; font-size: 13px; }
  .topbar { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; background: #fff; border-bottom: 1px solid #e5e7eb; }
  .topbar h2 { font-size: 16px; margin: 0; }
  form.inline { display: inline; }
  form.inline button { border: 0; background: none; color: #6b7280; font-size: 13px; cursor: pointer; padding: 0; }
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

export function renderDashboard(merchant: MerchantRow): string {
  const name = merchant.display_name ?? "사업자";
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
    <p class="muted">이벤트 등록 기능은 다음 단계에서 활성화됩니다.</p>
    <a class="btn btn-link" href="/merchant/event/new">새 이벤트 등록</a>
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
