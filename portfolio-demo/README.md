# 이벤트다 포트폴리오 소개 영상

`이벤트다`(parking-lot-navigator) iOS 앱을 소개하는 86.5초 포트폴리오 영상과, 그 영상을 다시 만들 수 있는 소스다.

- 최종 결과물: `out/eventda-portfolio.mp4` — 1920×1080 · 30fps · 86.5초 · H.264 (yuv420p) · 약 3.5MB · 무음
- 대본과 타임라인: [`SCRIPT.md`](SCRIPT.md)
- 자산 출처: [`ASSETS.md`](ASSETS.md)
- 주장별 근거: [`FACT_CHECK.md`](FACT_CHECK.md)
- 실제 앱 화면 녹화를 넣는 법: [`CAPTURE_GUIDE.md`](CAPTURE_GUIDE.md)

## 어떻게 만들어지나

Remotion 같은 프레임워크를 쓰지 않는다. 부품 세 개뿐이다.

1. `src/index.html` — 영상 전체가 들어 있는 한 장의 HTML. 시간축을 직접 노출한다.
   - `window.DURATION` — 전체 길이(초)
   - `window.seek(t)` — `t`초 시점의 화면을 그린다 (CSS 애니메이션 없음, 매 프레임 결정론적)
   - `window.__ready` — 폰트·이미지 로딩이 끝났다는 신호
2. `render.mjs` — Playwright가 내려받아 둔 Chromium을 1920×1080으로 띄우고,
   `seek(n/30)` → 스크린샷을 2595번 반복한다. PNG는 디스크에 쓰지 않고 파이프로 넘긴다.
3. `ffmpeg-static` — 받은 PNG 스트림을 libx264로 인코딩한다.

Playwright에 딸려 오는 ffmpeg은 `--disable-everything` 빌드라 H.264를 못 만든다.
그래서 인코딩만 `ffmpeg-static`의 바이너리로 한다.

## 다시 렌더링

```bash
cd portfolio-demo
npm install          # 최초 1회 (playwright-core, ffmpeg-static)
node render.mjs      # 약 4분 20초, out/eventda-portfolio.mp4 덮어쓴다
```

Chromium이 없다면 한 번만:

```bash
npx playwright install chromium
```

## 특정 시점만 확인

전체 렌더는 4분 넘게 걸린다. 한 장면만 고쳤다면 스크린샷 한 장으로 확인하는 편이 빠르다.

```bash
node render.mjs --preview 42      # out/preview-42s.png 저장
node render.mjs --to 30           # 0~30초 구간만 인코딩
```

## 내용 수정

- **문구만 고칠 때** — `src/index.html`에서 해당 `<section class="scene">` 안의 텍스트를 고치고 다시 렌더한다.
- **타이밍을 고칠 때** — 장면의 `data-in` / `data-out`(초)과 그 안 요소의 `data-at`(장면 시작 기준 상대 초)을 고친다.
  마지막 장면의 `data-out`을 바꿨다면 파일 아래쪽 `window.DURATION`도 같은 값으로 맞춰야 한다. 안 맞추면 끝이 잘리거나 검은 화면이 남는다.
- **장면을 추가/삭제할 때** — 뒤따르는 모든 장면의 `data-in` / `data-out`을 밀고 `window.DURATION`을 다시 계산한다.

등장 애니메이션은 `data-dy`(아래에서 위로 올라오는 픽셀), `data-grow="x"`(가로로 늘어남),
`data-dur`(지속 시간, 기본 0.55초)로만 표현한다. 새 효과가 필요하면 `src/index.html` 아래쪽
`applyAnim()` 함수에 추가한다.

## 폰트

`assets/fonts/`에 Pretendard와 JetBrains Mono(둘 다 SIL OFL)를 번들해 `@font-face`로 로드한다.
작업 환경에 한글 폰트가 하나도 없어서(`fc-list :lang=ko` → 0개) 시스템 폰트에 기댈 수 없었다.
JetBrains Mono에는 한글 글리프가 없으므로 mono 스택은 반드시 `JBMono, Pretendard, monospace` 순서를 지킨다.

## 사실성 원칙

이 영상은 채용 포트폴리오용이라 **저장소에서 확인되지 않는 기능·수치·성과를 넣지 않는다.**
새 문구를 추가할 때는 근거 파일 경로를 `FACT_CHECK.md`에 같이 적는다.
앱 화면은 실행 캡처가 아니라 뷰 구조를 옮긴 구성도이며, 그 사실을 화면 안 배지로 계속 밝힌다.
실행 화면 녹화가 생기면 `CAPTURE_GUIDE.md`의 절차로 그 자리에 끼우고, 배지 문구도 함께 고친다.
