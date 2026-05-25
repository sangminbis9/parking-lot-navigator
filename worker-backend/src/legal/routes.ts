import { Hono } from "hono";

const PRIVACY_HTML = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>이벤트다 개인정보처리방침</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif; max-width: 760px; margin: 32px auto; padding: 0 20px; line-height: 1.7; color: #1f2933; }
    h1 { font-size: 1.6rem; margin-bottom: 0.2em; }
    h2 { font-size: 1.15rem; margin-top: 2em; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.3em; }
    p, li { font-size: 0.98rem; }
    code { background: #f1f5f9; padding: 1px 5px; border-radius: 4px; }
    .meta { color: #64748b; font-size: 0.9rem; }
  </style>
</head>
<body>
  <h1>이벤트다 개인정보처리방침</h1>
  <p class="meta">시행일: 2026-05-25</p>

  <p>주식회사/개인사업자 운영주체(이하 "회사")는 이벤트다 iOS 앱(이하 "서비스") 이용자의 개인정보를 중요하게 생각하며, 「개인정보 보호법」 및 관련 법령을 준수합니다. 본 방침은 회사가 서비스 제공 과정에서 수집·이용·보관·파기하는 개인정보 항목과 그 처리 방식을 설명합니다.</p>

  <h2>1. 수집하는 개인정보 항목과 수집 방법</h2>
  <ul>
    <li>위치정보: 사용자가 권한을 허용한 경우 현재 위치(위·경도). 이벤트/축제/주차장 추천 결과를 보여주기 위해서만 사용합니다.</li>
    <li>기기 정보: iOS 버전, 앱 빌드 번호, 기기 모델 (오류 진단 및 호환성 유지 목적).</li>
    <li>공유 콘텐츠: 다른 앱에서 공유 확장으로 전달된 주소·장소명·URL (목적지 후보 생성 목적, App Group 임시 저장).</li>
    <li>머천트(가맹점 운영자) 계정 정보: 네이버 또는 카카오 OAuth 로그인 시 제공되는 식별자, 닉네임, 이메일. 머천트 본인 확인 및 결제 처리 목적.</li>
    <li>결제 정보: 토스페이먼츠 결제위젯을 통한 결제 처리 결과(주문번호, 결제 금액, 승인 시각). 카드번호 등 민감 결제정보는 회사가 직접 저장하지 않습니다.</li>
  </ul>

  <h2>2. 수집·이용 목적</h2>
  <ul>
    <li>이벤트/축제/주차장 추천 및 길안내 제공</li>
    <li>머천트의 가게 이벤트 등록·결제·노출</li>
    <li>서비스 운영, 오류 진단, 부정 이용 방지</li>
    <li>법령상 의무 이행(전자상거래법, 세법 등)</li>
  </ul>

  <h2>3. 개인정보 보유·이용 기간</h2>
  <ul>
    <li>위치정보: 단말 외부에 영구 저장하지 않으며, 요청 처리 시 1회성으로 사용 후 폐기합니다.</li>
    <li>머천트 계정 및 결제 기록: 전자상거래법 및 세법에 따라 최대 5년간 보관 후 파기합니다.</li>
    <li>공유 콘텐츠: 사용자가 목적지 확인을 마치거나 24시간 경과 시 App Group 저장소에서 삭제합니다.</li>
  </ul>

  <h2>4. 제3자 제공 및 처리위탁</h2>
  <ul>
    <li>지도 및 좌표 변환: Kakao(주) - Kakao Maps / Local API.</li>
    <li>OAuth 로그인: NAVER(주), Kakao(주).</li>
    <li>결제 처리: 토스페이먼츠(주).</li>
    <li>인프라: Cloudflare, Inc. (Workers, D1, R2).</li>
    <li>공공 데이터: 서울 열린데이터광장, 공공데이터포털, KOPIS, TourAPI, KCISA 등 공공기관에서 제공하는 공개 데이터를 표시 목적으로 사용합니다.</li>
  </ul>

  <h2>5. 이용자의 권리</h2>
  <p>이용자는 언제든지 자신의 개인정보에 대한 열람, 정정, 삭제, 처리 정지를 요청할 수 있습니다. 머천트 계정은 머천트 페이지 로그아웃 및 탈퇴 절차로 즉시 처리됩니다. 위치 권한은 iOS 설정 → 이벤트다에서 변경할 수 있습니다.</p>

  <h2>6. 개인정보 보호책임자</h2>
  <ul>
    <li>운영주체: (사업자 등록 후 갱신 예정)</li>
    <li>문의: <code>privacy@eventda.app</code></li>
  </ul>

  <h2>7. 고지의 의무</h2>
  <p>본 방침은 법령·서비스 변경에 따라 사전 공지 후 개정될 수 있습니다. 개정 내역은 본 페이지에서 확인하실 수 있습니다.</p>
</body>
</html>`;

const TERMS_HTML = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>이벤트다 이용약관</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif; max-width: 760px; margin: 32px auto; padding: 0 20px; line-height: 1.7; color: #1f2933; }
    h1 { font-size: 1.6rem; }
    h2 { font-size: 1.15rem; margin-top: 2em; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.3em; }
    .meta { color: #64748b; font-size: 0.9rem; }
  </style>
</head>
<body>
  <h1>이벤트다 이용약관</h1>
  <p class="meta">시행일: 2026-05-25</p>

  <h2>제1조 (목적)</h2>
  <p>본 약관은 이벤트다(이하 "서비스")의 이용 조건과 회사와 이용자 간 권리·의무 및 책임 사항을 규정함을 목적으로 합니다.</p>

  <h2>제2조 (서비스 내용)</h2>
  <ul>
    <li>이벤트·축제·로컬 매장 이벤트 정보 제공</li>
    <li>이벤트 주변 주차장 정보 및 길안내 보조</li>
    <li>가맹점(머천트)의 가게 이벤트 등록·노출 및 유료 노출 결제</li>
  </ul>

  <h2>제3조 (정보의 정확성)</h2>
  <p>서비스가 제공하는 이벤트·주차장 정보는 공공데이터 및 외부 제휴 채널을 기반으로 하며, 회사는 정보의 완전성·정확성·실시간성에 대해 보증하지 않습니다. 이용자는 현장 상황을 우선시해야 합니다.</p>

  <h2>제4조 (유료 머천트 서비스)</h2>
  <ul>
    <li>가맹점 이벤트 게시 상품: 1건당 10,000원(부가세 포함), 게시 기간 3개월.</li>
    <li>결제 수단: 토스페이먼츠 결제위젯.</li>
    <li>결제 완료 시 회사는 가맹점에게 결제 사실을 통지하며, 게시 기간 동안 서비스 내 노출을 제공합니다.</li>
  </ul>

  <h2>제5조 (이용자의 의무)</h2>
  <ul>
    <li>타인의 권리 침해, 허위·과장 정보 등록 금지</li>
    <li>법령 위반, 음란·차별·혐오 표현 금지</li>
    <li>자동화 도구로 서비스 데이터 무단 수집 금지</li>
  </ul>

  <h2>제6조 (서비스 변경 및 중단)</h2>
  <p>회사는 운영상·기술상 필요에 따라 서비스의 전부 또는 일부를 변경하거나 중단할 수 있으며, 이 경우 사전 또는 사후 공지합니다.</p>

  <h2>제7조 (책임 제한)</h2>
  <p>회사는 천재지변, 외부 API 장애, 이용자 단말 또는 네트워크 환경에 의한 손해에 대해 책임지지 않습니다. 회사의 고의 또는 중대한 과실이 없는 한, 회사의 손해배상 책임은 직접 손해로 한정됩니다.</p>

  <h2>제8조 (분쟁 해결)</h2>
  <p>본 약관은 대한민국 법령에 따라 해석되며, 서비스 이용에 관한 분쟁은 회사의 본점 소재지를 관할하는 법원을 1심 관할 법원으로 합니다.</p>
</body>
</html>`;

const REFUND_HTML = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>이벤트다 환불·취소 정책</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif; max-width: 760px; margin: 32px auto; padding: 0 20px; line-height: 1.7; color: #1f2933; }
    h1 { font-size: 1.6rem; }
    h2 { font-size: 1.15rem; margin-top: 2em; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.3em; }
    .meta { color: #64748b; font-size: 0.9rem; }
  </style>
</head>
<body>
  <h1>환불·취소 정책 (머천트 결제 전용)</h1>
  <p class="meta">시행일: 2026-05-25 · 적용 대상: 이벤트다 가맹점 이벤트 게시 상품</p>

  <h2>1. 적용 범위</h2>
  <p>본 정책은 머천트(가맹점 운영자)가 결제한 "가게 이벤트 게시 상품(10,000원 / 3개월)"에 한해 적용됩니다. 일반 앱 이용자의 결제는 발생하지 않습니다.</p>

  <h2>2. 청약 철회</h2>
  <ul>
    <li>전자상거래법 제17조에 따라, 결제 후 게시가 시작되기 전까지는 전액 환불됩니다.</li>
    <li>게시가 시작된 이후에는 디지털 콘텐츠 노출이 이미 제공된 것으로 보아 원칙적으로 환불이 제한됩니다.</li>
  </ul>

  <h2>3. 부분 환불 기준</h2>
  <ul>
    <li>회사 귀책 사유로 게시가 중단된 경우: 잔여 게시 기간에 비례하여 환불합니다.</li>
    <li>가맹점 귀책 사유(허위·법령 위반 등)로 게시가 중단된 경우: 환불되지 않을 수 있습니다.</li>
  </ul>

  <h2>4. 환불 방법</h2>
  <ul>
    <li>환불은 결제 수단과 동일한 경로(토스페이먼츠 취소)로 처리됩니다.</li>
    <li>환불 처리 기간은 영업일 기준 3~7일이 소요될 수 있습니다.</li>
  </ul>

  <h2>5. 문의</h2>
  <p>환불·취소 문의: <code>merchant@eventda.app</code></p>
</body>
</html>`;

export function createLegalApp(): Hono {
  const legal = new Hono();
  legal.get("/privacy", (c) => c.html(PRIVACY_HTML));
  legal.get("/terms", (c) => c.html(TERMS_HTML));
  legal.get("/refund-policy", (c) => c.html(REFUND_HTML));
  return legal;
}
