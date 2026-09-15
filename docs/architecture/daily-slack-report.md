# Slack 일일 앱 통계

작성: 2026-09-15, 갱신: 2026-09-16. 일일 보고와 사장님 신규 등록 즉시 알림을 같은 운영 Webhook으로 제공한다. Worker `906eb304-cad3-405e-97fe-82ebadbdc0c2` 운영 배포 완료.

## 발송 계약

- 첫 발송은 매일 20:00 KST(`11:00 UTC`)다. 일시 실패에 대비해 20:10·20:20에도 같은 Cron이 실행되지만, 비공개 R2의 날짜별 완료표시가 있으면 전송하지 않는다.
- Slack Incoming Webhook URL은 `SLACK_DAILY_REPORT_WEBHOOK_URL` Worker secret으로만 저장한다. 저장소, 로그, 응답 본문에는 URL을 기록하지 않는다. `hooks.slack.com` 또는 Slack Gov 주소만 허용한다.
- 관리자 토큰이 있는 `POST /api/admin/daily-slack-report`는 설치 직후 수동 시험용이며 `force=true` 동작이라 이미 보낸 날에도 한 번 더 전송한다.
- 사장님이 이벤트 폼 저장을 완료하면 `waitUntil`에서 저장된 행으로 Slack 카드를 즉시 보낸다. 제목·혜택·유형·설명·매장명·주소·쿠폰 링크·기간·등록 상태를 포함하며, 대표 이미지가 있으면 전체 이미지 블록도 붙인다.
- Slack 장애는 사장님 등록 성공을 되돌리지 않는다. 즉시 전송 실패 때만 `merchant-event-slack` Queue에 넣어 최대 2회 재시도하고, 성공 후 `ops/merchant-event-slack/{eventId}.json` R2 완료표시를 남겨 중복 전달을 막는다.

## 통계 정의

- 하루 접속자: 로그인 사용자가 아니라 **앱 설치별 KST 하루 최대 1회 전송되는 익명 `app_open`의 합계**다. 기기 ID·세션 ID·좌표를 서버에 보내거나 저장하지 않는다. 네트워크 실패, 분석 비활성화, 아직 새 iOS 빌드로 갱신하지 않은 사용자는 빠질 수 있어 best-effort DAU다.
- 새 축제: 오늘 `discovery_items.first_seen_at`인 공개 행사 중 박람회/공연을 제외한 수. 전시·일반 문화행사도 앱의 축제 도메인에 포함된다.
- 새 박람회: `primary_category='trade_expo'` 또는 `source='akei-trade-expo'`.
- 새 공연: `primary_category='music_performance'` 또는 `source='kopis'`.
- 새 로컬 이벤트: 오늘 생성된 `local_events` 전체 소스.
- 사장님 직접 등록: 오늘 `source='merchant'`로 생성된 행의 개수만 데일리 보고 요약에 표시한다. 개별 상세·쿠폰·이미지는 등록 직후 즉시 알림에서만 제공한다.

## 한도와 실패 정책

- Worker Cron trigger는 기존 3개에서 4개로 늘어 무료 계정 상한 5개 안이다.
- 새 Slack secret을 포함하면 환경변수는 62/64다. 코드 기본값과 같던 text var 2개를 제거해 두 칸의 운영 여유를 남겼고 런타임 동작은 바뀌지 않는다.
- 성공일에도 예약 invocation은 최대 3회/일이며, 20:10·20:20은 R2 `head` 후 종료한다. 완료표시는 R2에 하루 1회 쓴다.
- D1은 analytics PK 1행 lookup, discovery 약 12,700행 일일 1회 scan, local_events 일일 1회 집계 scan이다. 현재 discovery 기준 약 0.26%로 무료 5,000,000 rows-read/day에 작다. 일일 보고서 하나 때문에 `first_seen_at`/`created_at` 인덱스를 추가하면 모든 수집 쓰기가 증폭되므로 추가하지 않는다.
- 데일리 보고는 사장님 이벤트 상세 행을 읽거나 카드별로 메시지를 나누지 않고 항상 요약 메시지 1개만 전송한다.
- 즉시 알림은 정상 등록 1건당 Slack 요청 1회와 R2 `head`/성공표시 각 1회이며 추가 D1/Queue 사용은 없다. Slack 실패 때만 64KB 미만 Queue 메시지 1건(재시도 없는 정상 복구 약 3 operations)과 D1 단건 조회 1회를 쓴다. 지도 스냅샷 발행 예산과 별개다.
- Slack이 2xx를 반환한 뒤에만 R2 완료표시를 쓴다. 실패하면 다음 10분 회차에서 재시도한다. Webhook secret이 없으면 구조화 경고만 남기며 전송하지 않는다.

## 배포·검증

1. 원하는 Slack 대화/채널에 Incoming Webhook을 생성한다.
2. 로컬에서 `pnpm -C worker-backend exec wrangler secret put SLACK_DAILY_REPORT_WEBHOOK_URL`로 URL을 입력하거나 GitHub Actions secret에 같은 이름으로 등록한다.
3. Worker를 배포하고 관리자 토큰으로 `POST /api/admin/daily-slack-report`를 한 번 호출한다.
4. Slack 요약이 메시지 1개로 전송되고 사장님 직접 등록은 개수만 표시되는지, Worker 구조화 로그와 R2 `ops/daily-slack-report/YYYY-MM-DD.json` 완료표시를 확인한다.
5. 새 iOS 빌드를 배포한 뒤 `app_open`이 설치별 하루 1회로 집계되는지 다음날 비교한다.
6. 사장님 테스트 이벤트 한 건을 등록해 즉시 카드·쿠폰 버튼·대표 이미지와 `ops/merchant-event-slack/{eventId}.json` 완료표시를 확인한다.
