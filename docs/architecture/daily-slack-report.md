# Slack 일일 앱 통계

작성: 2026-09-15. 로컬 구현·Worker 테스트 완료, 운영 secret/배포/iOS 빌드는 대기다.

## 발송 계약

- 첫 발송은 매일 20:00 KST(`11:00 UTC`)다. 일시 실패에 대비해 20:10·20:20에도 같은 Cron이 실행되지만, 비공개 R2의 날짜별 완료표시가 있으면 전송하지 않는다.
- Slack Incoming Webhook URL은 `SLACK_DAILY_REPORT_WEBHOOK_URL` Worker secret으로만 저장한다. 저장소, 로그, 응답 본문에는 URL을 기록하지 않는다. `hooks.slack.com` 또는 Slack Gov 주소만 허용한다.
- 관리자 토큰이 있는 `POST /api/admin/daily-slack-report`는 설치 직후 수동 시험용이며 `force=true` 동작이라 이미 보낸 날에도 한 번 더 전송한다.

## 통계 정의

- 하루 접속자: 로그인 사용자가 아니라 **앱 설치별 KST 하루 최대 1회 전송되는 익명 `app_open`의 합계**다. 기기 ID·세션 ID·좌표를 서버에 보내거나 저장하지 않는다. 네트워크 실패, 분석 비활성화, 아직 새 iOS 빌드로 갱신하지 않은 사용자는 빠질 수 있어 best-effort DAU다.
- 새 축제: 오늘 `discovery_items.first_seen_at`인 공개 행사 중 박람회/공연을 제외한 수. 전시·일반 문화행사도 앱의 축제 도메인에 포함된다.
- 새 박람회: `primary_category='trade_expo'` 또는 `source='akei-trade-expo'`.
- 새 공연: `primary_category='music_performance'` 또는 `source='kopis'`.
- 새 로컬 이벤트: 오늘 생성된 `local_events` 전체 소스.
- 사장님 카드: 오늘 `source='merchant'`로 직접 등록된 행을 상태와 관계없이 등록 순서대로 표시한다. 가게/제목/상태/유형/기간/주소/혜택/설명/이미지를 포함하고, 사용자 문자열은 Slack mention이 되지 않게 이스케이프한다.

## 한도와 실패 정책

- Worker Cron trigger는 기존 3개에서 4개로 늘어 무료 계정 상한 5개 안이다.
- 새 Slack secret을 포함하면 환경변수는 62/64다. 코드 기본값과 같던 text var 2개를 제거해 두 칸의 운영 여유를 남겼고 런타임 동작은 바뀌지 않는다.
- 성공일에도 예약 invocation은 최대 3회/일이며, 20:10·20:20은 R2 `head` 후 종료한다. 완료표시는 R2에 하루 1회 쓴다.
- D1은 analytics PK 1행 lookup, discovery 약 12,700행 일일 1회 scan, local_events 일일 2회 scan이다. 현재 discovery 기준 약 0.26%로 무료 5,000,000 rows-read/day에 작다. 일일 보고서 하나 때문에 `first_seen_at`/`created_at` 인덱스를 추가하면 모든 수집 쓰기가 증폭되므로 추가하지 않는다.
- 일반적인 사장님 등록량은 Slack 외부 요청 1회다. Block Kit 50-block 한도를 지키기 위해 카드가 많으면 여러 메시지로 나누며, 단일 invocation의 외부 요청 상한을 넘지 않도록 하루 2,000개 안전 상한을 둔다. 상한 도달 시 Slack과 로그에 생략 수를 명시하고 별도 Queue/전용 리포팅 Worker를 검토한다.
- Slack이 2xx를 반환한 뒤에만 R2 완료표시를 쓴다. 실패하면 다음 10분 회차에서 재시도한다. Webhook secret이 없으면 구조화 경고만 남기며 전송하지 않는다.

## 배포·검증

1. 원하는 Slack 대화/채널에 Incoming Webhook을 생성한다.
2. 로컬에서 `pnpm -C worker-backend exec wrangler secret put SLACK_DAILY_REPORT_WEBHOOK_URL`로 URL을 입력하거나 GitHub Actions secret에 같은 이름으로 등록한다.
3. Worker를 배포하고 관리자 토큰으로 `POST /api/admin/daily-slack-report`를 한 번 호출한다.
4. Slack 요약/카드, Worker 구조화 로그, R2 `ops/daily-slack-report/YYYY-MM-DD.json` 완료표시를 확인한다.
5. 새 iOS 빌드를 배포한 뒤 `app_open`이 설치별 하루 1회로 집계되는지 다음날 비교한다.
