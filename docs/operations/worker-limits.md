# Worker 계정 한도

마지막 확인: 2026-08-16 (프로덕션 `parking-lot-navigator-api`, Cloudflare Workers 무료 플랜)

이 문서는 코드 설계를 직접 규정하는 플랫폼 한도를 한곳에 모은다. 배치 크기, cron
배치, 쿼리 모양이 전부 여기서 나왔다. **한도를 올리기 전에 이 표를 먼저 본다.**

| 한도 | 값 | 넘기면 벌어지는 일 | 이 한도에 묶인 코드 |
| --- | --- | --- | --- |
| invocation당 외부 fetch(subrequest) | 50 | 51번째 fetch가 `Too many subrequests by single Worker invocation`으로 throw. 초과분이 통째로 실패한다. | `feeBackfill.ts`(회차 30건), `geocodeBackfill.ts`(회차 25건), `imageBackfill.ts`(회차 30건), `localEventDiscovery.ts`(Naver/Kakao 호출) |
| invocation당 CPU 시간 | 10ms | 예외 없이 isolate가 종료된다. `wrangler tail`에 `Exceeded CPU Limit`으로만 남고 `try/catch`도 `notifyOpsFailure`도 타지 않는다. 진행 중이던 D1 쓰기는 손실. | cron 핸들러 전부. 예전에는 태깅과 backfill이 `*/20` 한 invocation에 얹혀 있어 backfill이 회차당 4건 남짓만 처리하고 죽었다. 지금은 `*/5`에서 한 invocation에 한 작업만 둔다 |
| 스크립트당 cron trigger | 5 | 6번째 스케줄은 `wrangler deploy`에서 거부된다. | `wrangler.toml`의 5개 스케줄. 새 주기가 필요하면 기존 cron에 시간/분 가드를 얹는다 |
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

## 유료 플랜으로 풀리는 것

Workers Paid($5/월) 전환 시 subrequest 50 → 1000, CPU 10ms → 30s(설정으로 최대 5분)로
올라간다. 다만 무료 플랜에서도 **한 invocation에 한 작업만 두고 cron 주기를 당기면**
같은 처리량을 얻는다 (2026-08-18, `*/20` 3분할 → `*/5` 4분할). 유료 전환은 그다음
단계이고, 전환하면 다음이 함께 풀린다.

- `LOCAL_EVENT_MAX_KAKAO_LOOKUPS`를 올려 로컬 이벤트 커버리지 확대
- `*/5`의 tagging/fee/geocode/image 4분할 로테이션을 없애고 매 회차 전부 실행
- `FEE_BACKFILL_MAX_ITEMS` 등 회차 상한 상향

## 관련 문서

- cron 배치와 슬롯 구조: `docs/PROJECT_STATE.md`의 "Cloudflare 리소스"
- 요금 파이프라인의 예산 근거: 루트 `CLAUDE.md`의 "요금 정보 파이프라인"
