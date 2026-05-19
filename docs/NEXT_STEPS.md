# Next Steps

Last updated: 2026-05-19

## Current Status

- Branch: `master`
- Latest pushed commit: `116fbcb Widen local event sources, rebalance subrequest budget`
- Product direction is festival/event discovery first, with parking/realtime as support for visiting selected destinations, plus a paid local-event registration funnel for merchants.
- Realtime parking and festival/event layers use overlap-collapsed pins.
- iOS build number is `1.0 (114)` in `ios-app/project.yml`. AgentOffice live activity feed has not been built/uploaded yet, so the next TestFlight needs `>114`.
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

## After Toss Production Keys Arrive

Blocking external item: 사업자등록증 발급 (in progress, applied 2026-05-18). After receipt:

1. Complete Toss Payments 가맹점 가입 with the new business registration.
2. Issue **결제위젯 연동 키** (do **not** use "API 개별 연동 키").
3. Replace `TOSS_CLIENT_KEY` in `worker-backend/wrangler.toml` with `live_gck_...`.
4. `pnpm -C worker-backend exec wrangler secret put TOSS_SECRET_KEY` with `live_gsk_...`.
5. `pnpm -C worker-backend run deploy`.
6. Run one real 10,000 KRW test transaction from a personal card; verify D1 row flips to `approved`, `paid_until = startDate + 3 months`, and `/api/local-events` exposes it.

## iOS Build / Release

- Codemagic/Xcode build is required only when iOS files change. The Settings link-out (`c31bf14`) has not been built yet.
- Before the next Codemagic/TestFlight run, bump `ios-app/project.yml` build number above `105` and confirm the publish log shows the new `Version code`.
- Verify "내 가게 이벤트 등록" button opens Safari to `https://parking-lot-navigator-api.parkingnav.workers.dev/merchant` on a real device (not just simulator) — Apple's review will check the link-out flow.

## After Worker Deploys

- Apply outstanding D1 migrations: `0005_local_events_admin.sql`, `0006_local_event_reports.sql`, `0007_merchant_signup.sql`, `0008_local_event_pending_payment.sql`. The `apply-d1-migrations.yml` workflow only lists 0001–0004; add the missing ones or run them via `wrangler d1 execute --remote --file <path>`.
- Run or wait for cron sync for realtime/discovery provider changes.
- Verify `/parking/nearby`, `/parking/realtime`, `/discover/festivals`, `/discover/events`, `/api/local-events`, and `/merchant` from the production Worker.

## Backlog

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
