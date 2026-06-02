# Next Steps

Last updated: 2026-06-02

## Current Status

- Branch: `master`
- Latest pushed commit: `3e64067 Add customizable festival/local-event notification settings with background discovery`
- Product direction is festival/event discovery first, with parking/realtime as support for visiting selected destinations, plus a paid local-event registration funnel for merchants.
- Realtime parking and festival/event layers use overlap-collapsed pins.
- iOS build number is `1.0 (164)` in `ios-app/project.yml`. 알림 설정 기능 변경분이라 다음 Codemagic 빌드로 컴파일 확인이 필요하다(이 번호의 빌드는 아직 미검증). 성공 빌드 확인 후 다음 TestFlight 업로드 시 `≥ 165` 로 bump 한다.
- Calendar tab (새 6번째 탭) + Medium WidgetKit widget (`UpcomingFestivalsWidget`) + 공유 필터(지역/반경/태그/상태)는 v1 로 출시되어 Codemagic 빌드까지 통과한 상태.
- Worker discovery and parking reads use D1/user endpoints with cron/admin sync for external provider calls.
- CI `deploy-worker` uses `wrangler versions secret put` to stage multiple secrets safely before the final `wrangler deploy`.

## Completed This Phase (Merchant + Toss MVP)

Phase 1 of the merchant/local-event monetization funnel landed end-to-end:

| Step                                                    | Result  | Commit    |
| ------------------------------------------------------- | ------- | --------- |
| Merchant signup landing + Naver/Kakao OAuth             | shipped | `13908cd` |
| Kakao client secret support                             | shipped | `becadbf` |
| Event registration form, image upload to R2, start date | shipped | `52a133e` |
| Toss Payments widget integration                        | shipped | `5b38483` |
| `/api/local-events` expiry + pending_payment filter     | shipped | `a5edbd8` |
| iOS Settings link-out to merchant web flow              | shipped | `c31bf14` |
| CI secret handling fix (versions secret put)            | shipped | `9d8be9d` |

D1 migration `0008_local_event_pending_payment.sql` is applied to the remote DB and committed.

Operational state:

- `MERCHANT_IMAGES` R2 bucket created and bound.
- `MERCHANT_SESSION_SECRET`, `KAKAO_CLIENT_SECRET`, `NAVER_CLIENT_ID/SECRET`, `KAKAO_REST_API_KEY` set as Worker secrets.
- `TOSS_CLIENT_KEY` (test widget key `test_gck_docs_...`) is in `wrangler.toml`; `TOSS_SECRET_KEY` (`test_gsk_docs_...`) is a Worker secret. Both must be replaced with `live_gck_...` / `live_gsk_...` after Toss merchant onboarding.

Validation done:

- `pnpm -C worker-backend typecheck` passes.
- Production smoke: `/api/local-events` returns approved-only non-sponsored rows; pending_payment row exists in D1 and is correctly hidden.
- D1 row counts (2026-05-19 snapshot): approved/non-sponsored 23, pending/non-sponsored 4, pending_payment/sponsored 1.

## Recently Shipped (Calendar revamp + Notifications)

- 캘린더 탭 개편(`c587edd`): 하단 인라인 어젠다, 카테고리 색 dot, 스와이프 월 이동, 저장(별표) + 시작 전 로컬 알림 리마인더, "오늘 / 이번 주말" 프리셋.
- 프로젝트 정밀 최적화(`cea4fca`): Worker GET 60s 엣지 캐시 + tags 단일 파싱, iOS 포매터/Calendar hoist, MapHomeView 데드코드 제거.
- 커스터마이즈 알림 설정(`3e64067`): 설정 → "알림" 전용 화면에서 축제/로컬 이벤트를 각각 분리해 발견 알림(카테고리/지역/반경)·리마인더 시점/시각·방해 금지 시간·하루 한도를 설정. `BGAppRefreshTask` 로 백그라운드 신규 발견 → 로컬 알림. APNs 미사용(best-effort).
  - 검증 필요: Codemagic 빌드(164)로 컴파일 확인. 실기기에서 설정 진입·권한 프롬프트·값 영속·`BGTaskScheduler` 시뮬레이션(`_simulateLaunchForTaskWithIdentifier:`) 확인.
  - 60s 엣지 캐시 활성화를 위한 Worker deploy 가 아직 남아 있으면 함께 처리한다(WSL 토큰 만료로 미배포 상태일 수 있음).

## After Toss Production Keys Arrive

Blocking external item: 사업자등록증 발급 (in progress, applied 2026-05-18). After receipt:

1. Complete Toss Payments 가맹점 가입 with the new business registration.
2. Issue **결제위젯 연동 키** (do **not** use "API 개별 연동 키").
3. Replace `TOSS_CLIENT_KEY` in `worker-backend/wrangler.toml` with `live_gck_...`.
4. `pnpm -C worker-backend exec wrangler secret put TOSS_SECRET_KEY` with `live_gsk_...`.
5. `pnpm -C worker-backend run deploy`.
6. Run one real 10,000 KRW test transaction from a personal card; verify D1 row flips to `approved`, `paid_until = startDate + 3 months`, and `/api/local-events` exposes it.

## iOS Build / Release

- Codemagic/Xcode build is required only when iOS files change.
- Latest 성공 빌드 번호는 `1.0 (134)` (`f3465f2` + `c65a3a5` 반영 후). 다음 Codemagic/TestFlight 업로드 시 `CURRENT_PROJECT_VERSION` 을 `≥ 135` 로 bump 후 publish 로그의 `Version code` 가 새 값을 가리키는지 확인한다.
- Verify "내 가게 이벤트 등록" button opens Safari to `https://parking-lot-navigator-api.parkingnav.workers.dev/merchant` on a real device (not just simulator) — Apple's review will check the link-out flow.
- 캘린더 탭/위젯 검증: 시뮬레이터 또는 실기기에서 ① 캘린더 dot 표시 ② 필터 시트 적용 시 dot/위젯 동기화 ③ 홈 화면에 Medium 위젯 추가 후 다가오는 축제 3개 카드 노출 ④ 빈 상태(90일 매칭 없음) 문구.

## Apple Developer / Codemagic Signing (Widget 추가 후)

- 신규 App ID `com.sangminbis9.ParkingLotNavigator.UpcomingFestivalsWidget` 등록 완료. App Groups capability 는 **Configure 버튼으로 `group.com.sangminbis9.ParkingLotNavigator` 매핑까지 완료**해야 한다 (체크박스만 켜는 것은 부족).
- Codemagic 은 **수동 사이닝(Manual)** 방식. 위젯용 distribution provisioning profile (`UpcomingFestivalsWidget` App ID + main app 과 동일한 distribution certificate) 을 새로 발급해 Codemagic Provisioning profiles 슬롯에 업로드한 상태이며, 빌드가 정상 통과함.
- 메인 app / Share Extension / Widget 세 App ID 모두 동일 App Group 에 매핑되어 있어야 한다. 추후 capability 추가/회전 시 세 App ID 모두를 같이 점검.

## After Worker Deploys

- Apply outstanding D1 migrations: `0005_local_events_admin.sql`, `0006_local_event_reports.sql`, `0007_merchant_signup.sql`, `0008_local_event_pending_payment.sql`. The `apply-d1-migrations.yml` workflow only lists 0001–0004; add the missing ones or run them via `wrangler d1 execute --remote --file <path>`.
- Run or wait for cron sync for realtime/discovery provider changes.
- Verify `/parking/nearby`, `/parking/realtime`, `/discover/festivals`, `/discover/events`, `/api/local-events`, and `/merchant` from the production Worker.

## Backlog

### Calendar / Widget v1.1 후보

- EventKit 연동: 축제 상세 → "기본 캘린더에 추가" 버튼. NSCalendarsUsageDescription, PrivacyInfo 갱신 필요.
- Small / Large 위젯 사이즈 추가 (현재 Medium 만 지원).
- Lock Screen / StandBy 위젯.
- 위젯 deep link 진입 (이벤트 상세 직진입).
- 필터 프리셋 저장 / 즐겨찾기 지역 기억.
- 백엔드 `/api/festivals` 에 `from`/`to` 날짜 범위 파라미터 추가 (현재는 90일 윈도우로 충분).

### Notifications v1.1 후보

- 서버 푸시(APNs): Apple Push 키 + Worker 구독 엔드포인트/D1 디바이스 토큰 테이블 + cron 매칭 발송. BGTask best-effort 한계(지연/누락)를 보완해 즉시성 확보.
- 알림 탭 → 해당 축제/이벤트 상세 딥링크 라우팅 (`UNUserNotificationCenterDelegate`).
- 로컬 이벤트 저장(별표) + 마감 임박 리마인더 (현재 로컬 이벤트는 저장 기능 없이 카테고리/지역 기반 발견 알림만).
- 개별 항목 알림(현재는 도메인별 요약 1건)과 알림 그룹/요약 정책 정교화.

### Merchant funnel hardening

- Merchant dashboard receipt/세금계산서 surfacing for paid events.
- Renewal flow: 7-day-before expiry email/SMS to merchant.
- Admin override to refund or extend `paid_until`.
- "내 가게 이벤트 수정/취소" page (currently the form is create-only).
- Better failure UX on Toss `/payment/fail` (right now it just renders the error code/message).

### Local event discovery

- Watch the post-budget-rebalance funnel: hourly cron with 17 search + 30 Kakao subrequests. Track `local_events` daily delta to confirm steady candidate growth.
- `kakao_lookup_budget_exhausted` still leaks ~80–100 candidates per invocation. Worker paid plan (subrequest 50 → 1000) is the cleanest fix; alternative is chunking keywords/sources so each invocation reaches more distinct stores.
- Search loop is deterministic (region → keyword → source). Same chunk repeatedly burns budget on the first keywords. Consider rotating the keyword/source order by `chunkIndex` so coverage spreads evenly.
- Add provider-specific detail enrichment for event descriptions where official APIs provide detail endpoints.
- Investigate Naver Place feed as an additional discovery source (public best-effort only; no header bypass or login cookies).

### Agent Office

- Tune Workers AI head agent prompt if the reject rate stays >50% — currently leans conservative.
- Surface `agent_activity` totals (per-agent counters) in the iOS Office scene header for at-a-glance progress.
- Consider exposing manual `pending → approved` overrides in admin to recover items the head agent over-rejected.

### Existing platform backlog

- Configure `PUBLIC_DATA_SERVICE_KEY`, `SEOUL_OPEN_DATA_KEY`, `CULTURE_PORTAL_API_KEY`, `KOPIS_API_KEY`, `KCISA_428_API_KEY`, `KCISA_196_API_KEY`, `KAKAO_REST_API_KEY` in Worker secrets, then verify discovery admin sync and D1-backed `/discover/*` endpoints.
- Get exact Seongdong IoT Seoul Open Data service name/field map if the provider still returns no rows.
- Add more regional realtime providers as approvals arrive.
- Improve provider health/debug visibility without exposing secrets.
- Update `apply-d1-migrations.yml` to include all migrations through 0008.

## New Session Prompt

Use this at the start of a new Codex/Claude session:

```text
Read docs/PROJECT_STATE.md, docs/DECISIONS.md, docs/NEXT_STEPS.md, and docs/API_RUNBOOK.md.
Continue from the current repo state. Do not repeat or store real API keys/tokens.
```
