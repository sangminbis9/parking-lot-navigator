# 사장님 이벤트 등록 흐름 스크린샷

매장 사장님이 이벤트를 등록하는 과정을 화면 순서대로 남긴 것이다. 캡처일 2026-09-12.

**App Store 제출용이 아니다.** 이 흐름은 iOS 화면이 아니라 Cloudflare Worker가 서버에서 그려주는
웹 페이지(`worker-backend/src/merchant/`)이고, 앱에서는 설정 탭의 사장님 카드가
`Link(destination:)`으로 **외부 Safari를 여는 것**뿐이다(`ios-app/Features/Settings/SettingsView.swift:140`).
App Store 스크린샷은 앱 자체 화면이어야 하므로 여기 이미지는 제출에 쓸 수 없다.
제출용은 `docs/release/screenshots/`에 따로 있다. 이 디렉터리의 용도는 문서·안내·온보딩이다.

## 화면 순서

| 파일 | 화면 | 경로 |
| --- | --- | --- |
| `01-landing.png` | 랜딩 — 가격 안내와 네이버/카카오 로그인 | `GET /merchant` |
| `02-dashboard.png` | 대시보드 — 등록한 이벤트 목록(게시 중 / 결제 대기) | `GET /merchant/dashboard` |
| `03-event-form.png` | 새 이벤트 등록 폼(빈 상태) | `GET /merchant/event/new` |
| `04-event-form-filled.png` | 등록 폼 입력 완료 — 약관 동의까지 | 같은 경로 |
| `05-free-claim.png` | 오픈 기념 무료 등록 확인 | `GET /merchant/event/:id/pay` |
| `06-dashboard-after.png` | 등록 완료 후 대시보드 — 결제 대기가 게시 중으로 바뀐다 | `POST /merchant/event/:id/claim-free` 후 리다이렉트 |

모두 1170×2532(390×844 CSS px, `deviceScaleFactor: 3`), 로케일 `ko-KR`, 타임존 `Asia/Seoul`.

## 결제 화면이 없는 이유

`launchPromoEnabled()`가 기본 true라서(`MERCHANT_LAUNCH_PROMO_FREE`를 `false`로 두지 않는 한)
`/event/:id/pay`는 Toss 결제 페이지 대신 무료 등록 화면을 그린다. 즉 지금 사장님이 실제로 보는
경로에는 결제 단계가 없다. Toss 가맹점 가입 자체도 아직 보류 상태다.

## 다시 뽑는 법

macOS도 실기기도 필요 없다. 로컬 D1 + `wrangler dev --local` + headless Chromium이면 된다.
실제 OAuth나 Kakao/Naver 키 없이 찍을 수 있게, 로그인은 세션 쿠키를 직접 만들어 주입하고
이벤트 행은 D1에 직접 넣는다.

1. 로컬 D1에 `merchants` 행과 데모 `local_events` 두 건(`approved` 하나, `pending_payment` 하나)을 넣는다.
2. 개발용 secret을 정해 Worker를 띄운다.

   ```bash
   npx wrangler dev --local --port 8787 \
     --var MERCHANT_SESSION_SECRET:<dev-secret> \
     --var KAKAO_REST_API_KEY:dummy \
     --var NAVER_CLIENT_ID:dummy --var NAVER_CLIENT_SECRET:dummy
   ```

3. 같은 secret으로 `createSessionToken`(`worker-backend/src/merchant/session.ts`)과 같은 방식의
   토큰을 만들어 `__merchant_session` 쿠키로 넣는다 — `base64url(JSON) + "." + base64url(HMAC-SHA256)`.
4. Playwright로 위 표의 경로를 순서대로 열며 캡처한다.

주의할 점 두 가지:

- **한글 폰트.** headless Chromium에 CJK 폰트가 없으면 모든 한글이 두부(□)로 찍히고, 캡처는
  성공한 것처럼 보인다. WSL2에서는 Windows의 `malgun.ttf`를 `~/.local/share/fonts`에 링크하고
  `fc-cache -f`를 돌리면 된다. 찍은 뒤 반드시 이미지를 눈으로 확인할 것.
- **폼 제출은 실제로 하지 않았다.** `POST /merchant/event/new`가 주소를 Kakao Local로 지오코딩하므로
  진짜 키가 필요하다. 그래서 `04`까지는 폼을 채우기만 하고, 그다음 화면은 미리 넣어 둔
  `pending_payment` 행의 결제 경로를 직접 열어 이었다. 화면 자체는 실제 코드가 그린 것이고,
  건너뛴 것은 지오코딩 한 단계뿐이다.

데모 데이터는 로컬 D1에만 있고 production에는 넣지 않았다.
