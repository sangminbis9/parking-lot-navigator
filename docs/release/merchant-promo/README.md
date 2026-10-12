# 사장님 대상 홍보 자료

신규 로컬 이벤트는 사장님 직접 등록으로만 들어온다(크롤러 제거, 2026-09-16). 앱의 로컬 이벤트 밀도는
사장님 유입에 달려 있어서, 그 유입 경로에 쓸 자료를 모아 둔다.

- 등록 페이지: https://parking-lot-navigator-api.parkingnav.workers.dev/merchant
  (카카오톡·네이버에 링크를 붙이면 제목·설명·앱 아이콘 미리보기가 뜬다 — `renderLanding`의 OG 태그)
- 손님용 앱: https://apps.apple.com/kr/app/id6762179556
- 무료 게시 기한: 2026-12-31 (`launchPromoEnabled`). 기한이나 요금이 바뀌면 아래 문구와 전단을 같이 고친다.

## 파일

- `flyer.html` — A4 전단 원본. 등록 페이지 QR이 SVG로 들어 있다.
- `flyer.pdf` / `flyer.png` — 인쇄용과 이미지 공유용. `flyer.html`을 Playwright Chromium으로 렌더링했다.

## 보낼 때 지킬 것

광고성 정보는 받는 사람의 사전 동의 없이 문자·카카오톡·이메일로 보내면 정보통신망법 제50조 위반이다.
모르는 가게에 일괄 발송하지 않는다. 아는 사장님에게 개인적으로 권하거나, 직접 방문해 전단을 건네거나,
커뮤니티 게시판 규칙이 홍보글을 허용하는 곳에만 올린다. 광고성 메시지라면 맨 앞에 `(광고)`를 붙인다.

## 문구

### 아는 사장님께 1:1로 (카카오톡)

```
사장님, 제가 만든 「이벤트다」라는 앱이 있어요. 근처 축제·행사를 지도로 보여 주는 앱인데,
가게 할인이나 무료 증정, 오픈 이벤트도 같은 지도에 올릴 수 있게 해 뒀어요.
올해 12월 31일까지는 무료라 한번 올려 보시면 좋겠어요. 네이버나 카카오 로그인 후 5분이면 됩니다.
https://parking-lot-navigator-api.parkingnav.workers.dev/merchant
```

### 자영업자 커뮤니티 게시글 (홍보 허용 게시판에만)

```
(광고) 가게 이벤트를 동네 손님 지도에 무료로 올리는 앱을 만들었습니다

「이벤트다」는 근처 축제·공연·박람회를 지도로 찾는 iPhone 앱입니다.
사장님이 할인, 무료 증정, 리뷰 이벤트, 팝업, 한정 메뉴, 오픈 이벤트를 등록하면
같은 지도와 이벤트 목록에 함께 뜹니다.

- 2026년 12월 31일까지 게시 무료 (이후 월 9,900원)
- 행사 알림을 켠 손님에게 이벤트 시작 30일·7일·1일 전 알림
- 내 이벤트를 몇 명이 열어 봤는지 대시보드에서 확인

등록: https://parking-lot-navigator-api.parkingnav.workers.dev/merchant
아직 초기라 앱 사용자 수는 많지 않습니다. 불편한 점을 알려 주시면 바로 고치겠습니다.
```

### SNS 한 줄

```
우리 가게 이벤트, 동네 손님 지도에 올리세요. 12월 31일까지 무료 → https://parking-lot-navigator-api.parkingnav.workers.dev/merchant
```

## 고칠 때

QR은 `qrcode` npm 패키지로 만든 SVG를 `flyer.html`에 그대로 넣었다. 주소가 바뀌면
`npx qrcode -t svg -o merchant.svg <새 주소>`로 다시 만들어 `<div class="qr">` 안의 `<svg>`를 바꾸고,
`page.pdf({ format: "A4", printBackground: true })`로 PDF를 다시 뽑는다.
