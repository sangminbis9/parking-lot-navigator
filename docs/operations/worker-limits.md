# Worker 계정 한도

마지막 확인: 2026-08-28 (프로덕션 `parking-lot-navigator-api`, Cloudflare Workers 무료 플랜)

이 문서는 코드 설계를 직접 규정하는 플랫폼 한도를 한곳에 모은다. 배치 크기, cron
배치, 쿼리 모양이 전부 여기서 나왔다. **한도를 올리기 전에 이 표를 먼저 본다.**

| 한도 | 값 | 넘기면 벌어지는 일 | 이 한도에 묶인 코드 |
| --- | --- | --- | --- |
| invocation당 외부 fetch(subrequest) | 50 | 51번째 fetch가 `Too many subrequests by single Worker invocation`으로 throw. 초과분이 통째로 실패한다. | `feeBackfill.ts` / `imageBackfill.ts` / `geocodeBackfill.ts` 모두 회차 45건 — `wrangler.toml`의 `FEE_BACKFILL_MAX_ITEMS` / `IMAGE_BACKFILL_MAX_ITEMS` / `GEOCODE_BACKFILL_MAX_LOOKUPS` 값이고, 코드 기본값(각 45/30/25)은 var가 빠졌을 때만 쓴다. `localEventDiscovery.ts`(Naver/Kakao 호출) |
| invocation당 CPU 시간 | 10ms | 예외 없이 isolate가 종료된다. `try/catch`도 `notifyOpsFailure`도 타지 않는다. **`wrangler tail`에는 아무 흔적도 안 남는다** — isolate가 로그를 flush하기 전에 죽어서, 킬 도중에도 tail은 `ok`만 찍는다(실측 2026-08-18: 12분 tail 전부 `ok`). 킬은 GraphQL `workersInvocationsAdaptive`의 `status=exceededResources`로만 보인다. 진행 중이던 D1 쓰기는 손실. | cron 핸들러 전부. 예전에는 태깅과 backfill이 `*/20` 한 invocation에 얹혀 있어 backfill이 회차당 4건 남짓만 처리하고 죽었다. 지금은 `*/5`에서 한 invocation에 한 작업만 둔다. 실측 2026-08-18: 24시간 892회 invocation 중 524회(59%)가 `exceededResources`로 죽었다 |
| 스크립트당 cron trigger | 5 | 6번째 스케줄은 `wrangler deploy`에서 거부된다. | `wrangler.toml`의 5개 스케줄. 새 주기가 필요하면 기존 cron에 시간/분 가드를 얹는다 |
| D1 일일 행 읽기 | 5,000,000 | **2026-09-01부터 강제된다.** 그 전에는 실측 2026-08-18에 10배(5,049만/일)를 넘겨도 거부가 없었다. 예외를 던지지 않으므로 초과는 조용히 일어난다 | 상관 서브쿼리와 정렬 쿼리 전부. 2026-08-28 실측 상위 10개 합계 135만/일(한도의 27%). 아래 "D1 행 읽기 예산" 참고 |
| D1 일일 행 쓰기 | 100,000 | 위와 같음(2026-09-01 강제). **현재 이 한도를 5배 넘고 있다** | 2026-08-28 실측 상위 10개 합계 549,917/일. `realtimeParkingCache.ts`(3분마다 최대 1000행 upsert)가 310,842행으로 57%, `discovery_items` upsert가 158,788행. 아래 "D1 행 쓰기 예산" 참고 |
| D1 prepared statement 바인딩 | 100 | 101번째 바인딩에서 쿼리가 실패한다. | `geocodeBackfill.ts`의 지역 대표 좌표 매칭(18좌표 × 4 + 1 = 73). `pipelineStats.ts`는 같은 조건을 리터럴로 박아 바인딩을 아예 안 쓴다 |

D1 쿼리는 subrequest 한도에 포함되지 않는다. Workers AI(`ai.run`) 호출은 포함된다.

## CPU 한도가 만드는 고유한 실패 모양

subrequest 초과는 예외를 던져서 잡히지만, CPU 초과는 **아무 흔적 없이 죽는다.**
그래서 아래 두 가지를 코드 규칙으로 둔다.

- **배치 쓰기를 회차 끝에 몰지 않는다.** 루프를 다 돌고 나서 `db.batch()`를 한 번만
  하면, 중간에 죽었을 때 그 회차의 외부 호출 결과가 전부 사라진다. 실제로
  `geocodeBackfill.ts`의 discovery 지오코딩이 이 이유로 하루 24회 전부 0건이었다.
  지금은 `DISCOVERY_FLUSH_SIZE`(5건)마다 나눠 쓴다. `imageBackfill.ts`도 같은 모양이라
  하루 24회 중 3회만 살아남아 90건/일에 그쳤고(실측 2026-08-18), `IMAGE_FLUSH_SIZE`(5건)
  단위로 fetch·판정·batch를 묶어 돌도록 고쳤다.
- **조용한 죽음은 `sync_runs`로만 관측된다.** 시작 기록만 있고 종료 기록이 없는 행을
  `reapStaleSyncRuns`가 `timeout`으로 마감하고, 그때 `OPS_ALERT_WEBHOOK_URL`로 알린다.

## D1 행 읽기 예산

CPU·subrequest와 달리 D1 행 읽기는 **한 쿼리가 조용히 수백만 행을 훑어도 에러가 나지
않는다.** 그래서 인덱스 하나가 빠지면 일일 예산이 통째로 날아간다. 실측 2026-08-18에
하루 5,049만 행을 읽고 있었고, 상위 4개 쿼리가 1,797만 행이었다.

| 쿼리 | 인덱스 전(실행당) | 인덱스 후(실행당) |
| --- | --- | --- |
| Orion(`headAgent.ts`) 후보 조회 | 3,513,719 | 2,849 |
| Pixel(`imageAgent.ts`) 로컬 이벤트 대상 | 962,251 | 2,352 |
| `sync_runs` 최근 15건 | 32,115 | 15 |
| `sync_runs` reaper UPDATE | 15,982 | 1 |

원인은 두 가지였고 `migrations/0021_hot_query_indexes.sql`이 둘 다 잡는다.

- `NOT EXISTS (SELECT 1 FROM agent_activity aa WHERE aa.target_id = ?)` 상관 서브쿼리에
  쓸 인덱스가 없어 후보 행마다 `agent_activity` 전체를 훑었다. `(target_id, agent_id,
  action)` 인덱스로 seek이 된다. **agent 쿼리에 새 필터 컬럼을 넣을 때 이 인덱스가
  여전히 맞는지 확인한다.**
- `sync_runs`에는 `(sync_type, started_at)` 인덱스만 있어서, `sync_type` 없이
  `started_at`으로 정렬하거나 `status`로 거르는 쿼리가 전부 전체 스캔이었다. 게다가 이
  테이블은 정리된 적이 없어 100일치 16,093행이 쌓여 있었다. `pruneOldSyncRuns`가 UTC
  6시 가드로 하루 1회 30일치만 남긴다.

## D1 행 쓰기 예산

읽기와 달리 쓰기는 인덱스 정리와 쿼리 모양만으로는 못 줄인다. **upsert 1건이 쓰는 행은
"본체 1행 + 그 테이블의 인덱스 수"**이기 때문이다. 인덱스를 하나 추가하면 그 테이블의 하루
쓰기가 upsert 건수만큼 통째로 늘어난다.

2026-08-28 실측(`wrangler d1 insights --sort-by writes --limit 10`, 1일 창):

| 쿼리 | 하루 쓰기 | 비고 |
| --- | --- | --- |
| `realtime_parking_status` upsert | 310,842 | 인덱스 3개 → 행당 4행 쓰기. 3분마다 최대 1000행 |
| `discovery_items` upsert | 158,788 | `0027` 이후 인덱스 11개 → 행당 12행 쓰기 |
| `idx_discovery_detail_backfill` 생성 | 40,530 | `0026` 마이그레이션의 1회성 인덱스 빌드 |
| 나머지 7개(태깅 UPDATE, agent/sync 로그 등) | 39,757 | |
| **합계** | **549,917** | 한도 100,000의 5.5배 |

이 창은 `0027` 적용 전후가 섞여 있고 1회성 인덱스 빌드도 포함한다. **깨끗한 재측정이 필요하다.**
다만 `realtime_parking_status` 한 쿼리만으로 이미 한도의 3배라, 인덱스 정리로는 해결되지 않는다.

줄일 수 있는 곳(아직 손대지 않음, 각각 동작 변화가 따라온다):

- `realtimeParkingCache.ts`의 `ON CONFLICT ... SET`에서 `lat`/`lng`를 빼면 하루 약 77,000행이
  준다(예산의 77%). 대신 원본이 좌표를 고쳐도 반영되지 않는다.
- 주차 sync 주기를 3분에서 늘리거나, 값이 실제로 바뀐 행만 쓰도록 조건부 upsert로 바꾸는 방법.

앞으로 늘어날 쪽은 알림 계획이다. `notification_sends`는 인덱스 3개라 계획 행 1건이 4행 쓰기이고,
계획은 기기 × 행사 조합이라 기기 수에 정비례한다. 2026-08-28 기준 미래 행사 3,712건 /
서로 다른 시작일 125일(하루 평균 29.7건)이므로 D-30·D-7·D-1을 합치면 기기당 하루 약 90건 =
360행이다. 기기 100대면 하루 36,000행으로 예산의 3분의 1이 알림만으로 나간다. 지금은
등록 기기가 적어 위 표에 안 잡히지만, 배포 후 기기 수가 늘면 이 항목이 먼저 커진다.

`0027_d1_read_budget_indexes.sql`은 쓰기 쪽에서 `discovery_items` 인덱스를 명시 13개 → 9개로
줄였다(추가 1, 삭제 5). 적용 확인:

```bash
pnpm -C worker-backend exec wrangler d1 execute parking-lot-navigator --remote \
  --command "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND tbl_name='discovery_items'"
# 11 = 명시 9 + UNIQUE autoindex 2  (2026-08-28 확인)
```

인덱스를 지울 때의 규칙은 `EXPLAIN QUERY PLAN`으로 **실제로 선택되지 않음**을 먼저 보이는 것이다.
옵티마이저는 `ORDER BY`를 공짜로 만족시키는 인덱스를 더 선택적인 인덱스보다 앞세우므로,
`idx_discovery_items_tagging(tagging_version)`처럼 만들어진 뒤 한 번도 안 골라진 인덱스가 생긴다.

## 유료 플랜으로 풀리는 것

Workers Paid($5/월) 전환 시 subrequest 50 → 1000, CPU 10ms → 30s(설정으로 최대 5분)로
올라간다. 다만 무료 플랜에서도 **한 invocation에 한 작업만 두고 cron 주기를 당기면**
같은 처리량을 얻는다 (2026-08-18, `*/20` 3분할 → `*/5` 4분할). 유료 전환은 그다음
단계이고, 전환하면 다음이 함께 풀린다.

- `LOCAL_EVENT_MAX_KAKAO_LOOKUPS`를 올려 로컬 이벤트 커버리지 확대
- `*/5`의 tagging/fee/geocode/image 4분할 로테이션을 없애고 매 회차 전부 실행
- `FEE_BACKFILL_MAX_ITEMS` 등 회차 상한 상향 (무료에서는 subrequest 50이 45에서 걸린다)

## 관련 문서

- cron 배치와 슬롯 구조: `docs/PROJECT_STATE.md`의 "Cloudflare 리소스"
- 요금·프로그램 파이프라인의 예산 근거: 루트 `CLAUDE.md`의 "요금·프로그램 정보 파이프라인"
- 인덱스 규칙과 실측 요약: 루트 `CLAUDE.md`의 "D1 인덱스와 행 읽기·쓰기 예산"
