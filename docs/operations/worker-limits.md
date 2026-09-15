# Worker 계정 한도

## 2026-09-15 예약 실행/정적 발행 실패 수정 — 배포 대기

- 최근 1시간 대시보드에서 성공 293건/오류 37건을 확인했고, 표본 예약 실행의 outcome은 `exceededCpu`였다. 하나의 매분 invocation이 Queue dispatch, 실시간 주차, 스냅샷 복구를 함께 시작하던 구조를 원인 후보로 좁혔다.
- Cron을 dispatch `* * * * *`, 실시간 `*/4 * * * *`, 스냅샷 복구 `2-57/5 * * * *`로 분리한다. 계정 한도 5개 중 3개를 사용하며 각 invocation의 작업 종류를 하나로 격리한다. 실시간 4개 shard의 전체 순회는 약 16분이다.
- 11:35 KST 무렵 발행 Queue 예산은 327/650이었다. 짧은 변경 묶음은 마지막 scan과 publish를 같은 Queue 소비에서 완료해 별도 메시지 하나를 절약한다.
- 정적 발행 workflow는 검증된 기존 CDN 릴리스가 있고 `publication_queue_budget`의 미래 `retryAt`이 확인될 때만 성공적인 defer로 기록한다. 실제 손상·예상 밖 unhealthy·첫 릴리스 부재는 계속 실패한다.
- Worker 40파일/348테스트, 발행기 12테스트, TypeScript, Wrangler dry-run 통과. 아직 운영 Worker와 GitHub workflow에는 배포하지 않았다. 배포 후 30~60분 실제 outcome과 checkedAt 전진을 재측정한다.

## 2026-09-13 후속: 정적 파일 직접 제공과 소스 순회

행사 파일은 사용자 선택에 따라 도메인 없는 Workers Static Assets로 발행한다. 앱 새 빌드의 행사 파일 요청은 API Worker를 거치지 않지만, 실시간 주차/기존 앱/수집 요청은 남는다. 5분 GitHub 변경 검사로 생기는 원본 요청은 manifest/status와 새 파일에 한정된다(기존 파일은 CDN 재사용). 예약 지연 가능, 정적 발행은 부분 파일을 공개하지 않는다.

소스 3개/시간=72개/일로 130개 재방문을 약 13일에서 44시간으로 단축한다. 사이트당 geocode miss 3/detail 1은 유지하므로 이 부분 최대 geocode 요청은 216/일. 기존 Queue 최악 2,482메시지에서 +62=2,544(7,632 ops). 행사 스냅샷 신규 메시지 예산을 650(1,950 ops)으로 낮춰 합계 9,582 ops/일, 재시도 등 418 ops 여유를 둔다. 이는 이론적 계획 예산이며 실제 요청/행 읽기/쓰기는 배포 후 관찰해야 한다. 이후의 700/일 수치는 이전 배포 이력이다.

## 2026-09-13 추가: 변경 기반 행사 스냅샷 (최초 발행·운영 검증 완료)

일일 전체 생성 대신 D1 0032 트리거가 변경된 고정 묶음을 기록한다. 최초 128개 묶음 준비 후 변경분만 읽는다. 별도 5분 Cron이 미처리 인덱스를 Queue 없이 확인하고, 발행 신규 메시지를 650/UTC일로 제한한다. 기존 최악 추산 7,632 ops + 발행 통상 최대 1,950 ops = 9,582 ops이며, 재시도와 다른 생산자는 별도다. 예산 소진은 발행 지연으로 처리하고 기존 공개 데이터/변경 기록을 유지한다. 앱 행사 탐색과 /parking/realtime은 R2/공유 캐시를 이용한다. 정적 주차·구버전 행사 API·수집·관리 작업의 D1 사용량은 남는다. [설계·한계·검증](../architecture/discovery-snapshots.md).

09:00~09:39 KST 대시보드 관측(단일 DB, 초기화 이후 일부 구간): 읽기 약 398k, 쓰기 약 7k. 기존 위치 기반 행사 페이지 쿼리 38회가 273.52k행, 새 discovery 묶음 쿼리 56회가 5.55k행, local 묶음 쿼리 42회가 580행을 읽었다. 일부 기간/쿼리 관측이며 하루 총량이나 전체 계정 한도 보장은 아니다. 09:33 발행 Queue 예산 카운터는 202 메시지였다. 수성 공급자는 down, KAC 공항은 빈 결과/degraded로 관측됐지만 대전·서울·인천공항의 정상 데이터는 별도로 발행됐다.

마지막 확인: 2026-09-11 (프로덕션 `parking-lot-navigator-api`, Cloudflare Workers 무료 플랜)

2026-09-11 재검증 범위: cron 슬롯 사용량·Queue operation 예산·subrequest 상한을 현재
`src/jobs.ts` / `src/index.ts` / `wrangler.toml` 코드 기준으로 다시 대조했고 아래 표·절의
숫자가 그대로 맞는 것을 확인했다. **D1 일일 행 쓰기만 아직 `실측 필요` 상태다** — 이유와
절차는 "D1 행 쓰기 24시간 실측 절차" 참고.

이 문서는 코드 설계를 직접 규정하는 플랫폼 한도를 한곳에 모은다. 배치 크기, cron
배치, 쿼리 모양이 전부 여기서 나왔다. **한도를 올리기 전에 이 표를 먼저 본다.**

| 한도 | 값 | 넘기면 벌어지는 일 | 이 한도에 묶인 코드 |
| --- | --- | --- | --- |
| invocation당 외부 fetch(subrequest) | 50 | 51번째 fetch가 `Too many subrequests by single Worker invocation`으로 throw. 초과분이 통째로 실패한다. | `feeBackfill.ts` / `imageBackfill.ts` / `geocodeBackfill.ts` 모두 회차 45건 — `wrangler.toml`의 `FEE_BACKFILL_MAX_ITEMS` / `IMAGE_BACKFILL_MAX_ITEMS` / `GEOCODE_BACKFILL_MAX_LOOKUPS` 값이고, 코드 기본값(각 45/30/25)은 var가 빠졌을 때만 쓴다. `localEventDiscovery.ts`(Naver/Kakao 호출) |
| invocation당 리소스 한도 (`exceededCpu` / `exceededResources`) | 문서상 Free CPU 10ms — **이 Worker에서는 그렇게 강제되지 않는다**(아래 절의 2026-09-04 실측: scheduled invocation이 243ms를 쓰고 `ok`) | 예외 없이 isolate가 종료된다. `try/catch`도 `notifyOpsFailure`도 타지 않고, 진행 중이던 D1 쓰기는 손실된다. **`wrangler tail --format json`의 `outcome` 필드에 `exceededCpu`로 찍힌다**(실측 2026-09-04, wrangler 4.92.0). 2026-08-18에는 tail이 킬 도중에도 `ok`만 찍어서 GraphQL `workersInvocationsAdaptive`로만 보였는데, 지금은 tail로 바로 관측된다 — 진단은 tail을 먼저 본다. | 실측상 거의 전부 `*/3` 실시간 주차 sync 한 곳이었다. Queue 분할 배포(2026-09-04) 이후 관측 창에서는 킬이 사라졌다. 아래 "무엇이 리소스 한도로 죽는가" 참고 |
| 스크립트당 cron trigger | 5 | 6번째 스케줄은 `wrangler deploy`에서 거부된다. | 현재 수정안은 dispatch/실시간/스냅샷 복구의 3개(3/5)를 쓰고, 나머지 작업은 dispatch가 Queue로 분배한다 |
| D1 일일 행 읽기 | 5,000,000 | **2026-09-01부터 강제된다.** 그 전에는 실측 2026-08-18에 10배(5,049만/일)를 넘겨도 거부가 없었다. 예외를 던지지 않으므로 초과는 조용히 일어난다 | 상관 서브쿼리와 정렬 쿼리 전부. 2026-08-28 실측 상위 10개 합계 135만/일(한도의 27%). 아래 "D1 행 읽기 예산" 참고 |
| D1 일일 행 쓰기 | 100,000 | 위와 같음(2026-09-01 강제). **`실측 필요` — 깨끗한 24시간 창을 아직 못 쟀다** | 2026-08-29 실측 상위 10개 합계 474,322/일(한도의 4.7배)에서 `0028`(realtime 행당 3행 → 1행)과 조건부 쓰기(discovery/realtime/태깅)로 내려왔다. 가장 최근 측정은 2026-09-01T09:47Z 24시간 창의 **58,513행(한도의 59%)**인데, 그 창은 **앞 5.7시간이 조건부 쓰기 배포(2026-08-31T15:29Z) 전**이라 완전히 깨끗하지 않다. 배포 후 구간만으로 이뤄진 창을 다시 재기 전에는 확정치로 쓰지 않는다. 아래 "D1 행 쓰기 예산" 참고 |
| D1 prepared statement 바인딩 | 100 | 101번째 바인딩에서 쿼리가 실패한다. | `geocodeBackfill.ts`의 지역 대표 좌표 매칭(18좌표 × 4 + 1 = 73). `pipelineStats.ts`는 같은 조건을 리터럴로 박아 바인딩을 아예 안 쓴다 |

D1 쿼리는 subrequest 한도에 포함되지 않는다. Workers AI(`ai.run`) 호출은 포함된다.

## 무엇이 리소스 한도로 죽는가

subrequest 초과는 예외를 던져서 잡히지만, 리소스 한도 킬은 **코드 쪽에 아무 흔적도
남기지 않는다.** 오랫동안 이 킬을 "invocation당 CPU 10ms 초과"로 적어 뒀는데, 2026-09-01
실측이 그 설명을 뒤집었다.

측정은 `workersInvocationsAdaptive`를 `datetimeMinute`으로 뽑아 분(minute)별로 가른
것이다. cron 주기가 분에 새겨져 있어(`*/3`·`*/5`·`*/9`·`15`·`30 */3`) 코드에 계측을
넣지 않고도 어느 스케줄이 죽는지 갈린다. 창은 2026-08-31T11:53Z ~ 2026-09-01T11:53Z
24시간이다.

| 분에 도는 job | 킬 비율 | 성공 invocation cpuP50 | 죽은 invocation cpuP50 |
| --- | --- | --- | --- |
| `*/3` 실시간 주차 sync만 (분 3·6·12·24·33·39·42·48·51·57) | 57~83% | 89~203ms | 11~20ms |
| `*/9` discovery 청크가 겹치는 분 (0·9·18·27·36·45·54) | 19~60% | 18~141ms | 10~16ms |
| `*/5` backfill만 (분 5·10·20·25·35·40·50·55) | 0~5.6% | 1.4~84ms | 10ms |
| cron 없는 분 (앱 요청만) | 대체로 0% | 2.3~131ms | — |

여기서 두 가지가 확정된다.

- **CPU 10ms 하드 캡은 이 Worker에 걸려 있지 않다.** 성공한 invocation이 일상적으로
  89~203ms CPU를 쓴다. 10ms에서 잘린다면 나올 수 없는 값이다.
  다만 이 표의 "성공 cpuP50"은 **분 단위 집계라 같은 분에 섞인 앱 HTTP 요청이 함께 들어
  있다** — cron invocation 자체가 그 값을 썼다는 증거는 못 된다. 이 결론을 실제로 받치는
  것은 아래 2026-09-04 절의 invocation 단위 실측(scheduled 243ms `ok`)이다.
- **죽은 쪽 CPU가 천장에 붙지 않는다.** CPU 한도로 죽으면 죽은 invocation의 CPU가
  상한에 닿아야 하는데, 실측은 정반대다 — 죽은 쪽(11~20ms)이 산 쪽(89~203ms)보다 훨씬
  **낮다.** 2026-09-04 tail 실측에서도 `exceededCpu`로 죽은 회차의 `cpuTime`이 10·10·19ms로
  똑같이 낮았다. 플랫폼은 이 킬을 CPU로 분류하지만, 보고되는 CPU 값은 상한과 무관하다.

죽는 곳은 한 군데로 좁혀졌다: `*/3` 실시간 주차 sync다. `*/5` backfill(회차 45건, 항목당
fetch 1건)은 거의 죽지 않고, discovery 청크와 앱 요청도 대체로 산다. (cron 없는 분과
`*/5` 분의 성공 cpuP50이 넓게 흩어지는 건 같은 분에 섞인 앱 요청 때문이다.)

남은 1순위 가설은 **메모리(128MB — 무료·유료 공통)**다. 실시간 sync는
`CompositeParkingProvider.nearby()`가 8개 provider를 `Promise.all`로 동시에 돌리고,
그중 `SeoulRealtimeParkingProvider`는 `GetParkingInfo`와 `GetParkInfo`를 각각 1000행짜리
페이지 최대 10장씩 다시 `Promise.all`로 받는다. `SeoulParkingMetadataProvider`가 같은
`GetParkInfo`를 한 번 더 받는다. 응답 본문과 파싱된 배열이 한 시점에 전부 힙에 살아 있고,
`RawParkingRecord.rawSourcePayload`가 원본 행을 레코드마다 그대로 붙들고,
`mergeRecord`가 그걸 `{ merged: [...] }`로 한 겹 더 감싼다 — 그런데 Worker의
`realtimeParkingCache.ts`는 upsert에서 `raw_payload`에 **`null`을 바인딩한다.** 끝까지
안 쓰는 값을 파이프라인 내내 들고 있는 셈이다. I/O 대기는 CPU로 안 잡히므로 이 지점에서
죽으면 CPU가 낮게 찍히는 것도 설명된다.

**아직 가설이다.** `exceededResources`는 CPU·메모리를 구분해 주지 않아서, 확정하려면
실시간 sync의 최대 메모리를 실제로 줄여 보고 킬 비율이 떨어지는지 봐야 한다. 후보는
(1) `fetchAllSeoulRows`의 페이지 `Promise.all`을 순차 루프로, (2) 두 provider가 각자 받는
`GetParkInfo` 중복 제거, (3) Worker 경로에서 쓰지 않는 `rawSourcePayload` 미보관.

### 2026-09-04 실측 — tail이 킬을 직접 보여준다, 그리고 Queue 분할이 킬을 없앴다

`wrangler tail --format json`(wrangler 4.92.0)이 이제 `outcome` 필드에 킬을 그대로 찍는다.
2026-08-18에 "tail은 킬 도중에도 `ok`만 찍는다"고 적었던 것은 더 이상 사실이 아니다.
GraphQL을 뽑지 않고도 invocation 단위로 갈라 볼 수 있으니 **진단은 tail을 먼저 본다.**

Queue 분할 배포(커밋 `536bd28`) **직전**, 옛 5-cron 구조에서 9분 창:

| trigger | outcome | cpuTime | wallTime |
| --- | --- | --- | --- |
| `*/3` (실시간 주차) | **exceededCpu** | 10ms | 283ms |
| `*/3` | **exceededCpu** | 10ms | 507ms |
| `*/3` | **exceededCpu** | 19ms | 583ms |
| `*/9` (discovery 청크) | ok | 8ms | 869ms |
| `*/5` (backfill) | ok | 1ms | 172ms |
| HTTP fetch | ok | 93ms / 127ms | — |

배포 **직후** 같은 방식으로 10.5분(창 두 개, 27 invocation, 예외 0건):

| 종류 | n | outcome | cpu min/med/max |
| --- | --- | --- | --- |
| cron `* * * * *` | 9 | ok | 5 / 80 / 157ms |
| queue consumer | 13 | ok | 1 / 3 / 48ms |
| HTTP fetch | 3 | ok | 6 / 13 / 134ms |
| cron `*/3`·`*/5` (트리거 전파 잔여) | 2 | ok | 121 / 243ms |

**`exceededCpu` 0건.** 그리고 scheduled invocation이 243ms를 쓰고도 살았다 — 10ms 캡이
없다는 위 결론을 invocation 단위로 다시 확인한 셈이고, 앱 요청이 섞이지 않은 깨끗한 증거다.

두 창은 각각 9분·10.5분짜리 **스팟 샘플이지 일일 비율이 아니다.** 킬이 완전히 사라졌다고
단정하려면 하루치가 필요하다. 다만 배포 전 `*/3`은 관측한 3회가 전부 죽었고 배포 후에는
27회 중 0회다.

부수 효과로 `discover:events:kopis`가 배포 직후 첫 회차(2026-09-04T03:27:45Z)에서
`success`로 닫혔다 — 직전 24시간은 success 2 / timeout 17이었고, 그 timeout의 절반은
`reaped: stale running`(회차가 마감 전에 죽었다는 뜻)이었다. 제공자 청크마다 invocation을
통째로 주는 설계의 예상 효과와 맞지만, 아직 표본 1건이다.

참고로 **회차 45건 상한은 CPU가 아니라 subrequest 50건에서 나온 값이라 이 실측과
무관하다**(위 표 첫 행). `*/5`의 분 슬롯 분할도 마찬가지로 한 invocation이 subrequest
예산을 통째로 쓰게 하려던 것이고, 실측에서 그 슬롯들은 실제로 거의 죽지 않는다.

조용한 죽음 때문에 아래 두 가지는 그대로 코드 규칙으로 둔다.

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

읽기와 달리 쓰기는 인덱스 정리와 쿼리 모양만으로는 못 줄인다. **새 INSERT 1건이 쓰는 행은
"본체 1행 + 그 테이블의 인덱스 수"**이기 때문이다(upsert가 기존 행을 갱신할 때는 그게 상한이고,
실제로는 다시 쓰이는 컬럼의 인덱스만 갱신된다 — 아래 정정 참고). 인덱스를 하나 추가하면 그
테이블의 하루 쓰기가 그만큼 통째로 늘어난다.

2026-08-29 실측(`wrangler d1 insights --sort-by writes --limit 10`, 1일 창).
`0027` 배포 후 만 하루가 지난 깨끗한 창이고 1회성 인덱스 빌드도 빠졌다:

| 쿼리 | 하루 쓰기 | 실행 | 행당 | 비고 |
| --- | --- | --- | --- | --- |
| `realtime_parking_status` upsert | 343,553 | 114,515 | 3.0 | 전체의 72% |
| `discovery_items` upsert | 97,494 | 8,560 | 11.4 | `0027` 전 158,788에서 39% 감소 |
| `discovery_items` 태깅 UPDATE | 21,218 | 9,734 | 2.2 | |
| detail backfill 선점 UPDATE | 7,118 | 3,559 | 2.0 | `0026`이 추가한 선점 |
| 나머지 6개 | 4,939 | | | agent/sync 로그, 요금·프로그램 반영 |
| **합계** | **474,322** | | | 한도 100,000의 4.7배. 아래 두 조치로 약 82,000/일 예상 |

2026-08-28 창(549,917)과 비교하면 75,595행이 줄었다. 감소분은 대부분 `discovery_items`
인덱스 정리(명시 13개 → 9개)와 1회성 인덱스 빌드 40,530행이 빠진 것이다.

**측정으로 드러난 정정: 쓰기 증폭은 "인덱스 수 + 1"이 상한이지 항상 그 값은 아니다.**
`ON CONFLICT DO UPDATE`는 `SET`에 등장해 실제로 다시 쓰이는 컬럼의 인덱스만 갱신한다.
`realtime_parking_status`는 인덱스가 3개(PK autoindex, `(lat, lng)`, `(last_seen_at)`)라
상한이 4행이지만 실측은 정확히 3.0행이다 — `id`가 바뀌지 않아 PK autoindex는 안 쓰이고,
본체 1 + `(lat, lng)` 1 + `(last_seen_at)` 1만 쓴다.

### 2026-08-29 조치: realtime upsert를 행당 3행 → 1행으로

이 정정이 그대로 조치가 됐다. `SET`에 등장하는 컬럼의 인덱스만 갱신되므로, 갱신 대상에서
컬럼을 빼거나 인덱스를 지우면 쓰기가 그만큼 사라진다. 두 가지를 같이 했다.

- `realtimeParkingCache.ts`의 `ON CONFLICT ... SET`에서 `lat`/`lng` 제거 → `(lat, lng)`
  인덱스 갱신이 사라진다(행당 3행 → 2행, **하루 115,349행 절감**).
- `0028_realtime_parking_write_budget.sql`이 `idx_realtime_parking_status_last_seen`
  삭제 → 남은 인덱스 갱신도 사라진다(행당 2행 → 1행, **다시 115,349행 절감**).

합쳐서 **346,055 → 115,349행/일**이고, sync 주기(3분)도 prune 계약(`last_seen_at < ?`로
이번 회차에 안 보인 행을 지운다)도 그대로다. 즉 실시간성을 대가로 내주지 않았다.

대가는 둘이다. (1) 원본이 좌표를 고쳐도 기존 행에는 반영되지 않는다 — 피드에서 한 번
빠졌다 돌아오는 주차장은 prune 후 재삽입 때 새 좌표를 받는다. (2) prune DELETE가
인덱스 탐색에서 전체 스캔으로 바뀐다. 이 테이블은 866행(2026-08-29 실측)이라 prune
1회당 읽기가 그만큼이고, 읽기는 한도의 27%라 감당된다. 읽기가 병목이 되면 마이그레이션
주석에 적힌 `CREATE INDEX` 한 줄로 되돌린다.

**검토했지만 택하지 않은 방향:** **sync 주기 조정**(3분 → 6분 등). 절감은 주기에 정비례하지만,
이 기능이 존재하는 이유인 실시간성을 그대로 깎는다. 위 조치는 같은 크기의 절감을
실시간성 손실 0으로 얻는다.

### 2026-08-29 조치 2: 조건부 쓰기 — 수집은 자주, DB에는 바뀐 것만

`0028`까지 해도 하루 약 243,600행으로 한도의 2.4배였다. 남은 것은 "같은 값을 다시 쓰는" 쓰기
자체였고, 여기서 수집 주기를 건드리지 않고 그것만 없앴다.

세 파이프라인 모두 같은 모양이다 — 배치마다 기존 행을 **한 번** SELECT하고 네 갈래로 가른다.

| 갈래 | 처리 | 쓰기 |
| --- | --- | --- |
| 신규 | 전체 INSERT | 본체 + 인덱스 수 |
| 내용이 바뀜 | 기존 upsert 그대로 | 위와 같음 |
| 동일 + heartbeat 간격 경과 | `last_seen_at`만 미는 최소 UPDATE | discovery 3행 / realtime 1행 |
| 동일 + heartbeat 남음 | **쓰지 않는다** | 0 |

전제 두 가지가 회귀를 막는다.

- **비교에서 휘발성 필드를 뺀다.** discovery의 `raw_payload`에는 조회 중심점마다 달라지는
  `distanceMeters`·`distanceFromDestinationMeters`와, 소스에 값이 없으면 `new Date()`로 채워지는
  `updatedAt`이 들어 있다. realtime은 대전 피드가 시각을 안 줘서 provider가 매 회차 채우는
  `freshness_timestamp`/`updated_at`이 같은 문제다. 이걸 빼지 않으면 내용이 그대로여도
  매번 "변경"으로 판정돼 조건부 쓰기가 통째로 무의미해진다.
- **prune 기준을 시간 기반으로 옮긴다.** `pruneUnseenRealtimeParking`이 `last_seen_at < syncedAt`
  으로 지우면 값이 안 바뀐 행이 전부 죽는다. 지금은 보존 기간 기준이고, 세 값의 순서가 계약이다:
  **heartbeat(30분) < 조회 신선도(45분) < prune 보존(90분).** discovery는 heartbeat 24시간 대
  프루닝 100일(축제)이라 100배 여유가 있다.

`0028`이 만든 좌표 회귀도 여기서 닫았다. 좌표는 본 upsert의 `SET`에 없으므로, 실제로 달라진
행만 `UPDATE ... SET lat = ?, lng = ?`로 따로 고친다(오차 `1e-7`). 이 UPDATE는 `last_seen_at`을
건드리지 않아 prune 시계를 멈추므로 heartbeat를 같이 보낸다.

태깅 쪽은 성격이 다르다. LLM 실패 후 결정론적 fallback으로 확정된 행(`tagging_version = -1`,
실측 999건)이 **매 cron마다 다시 조회되고 다시 기록되고** 있었다. 영구 제외하면 나중에 LLM
보강 기회가 사라지므로, `tagged_at`이 7일보다 오래된 것만 다시 잡는 backoff를 넣었다.

**예상 절감(아직 실측 아님 — 배포 후 만 하루가 지난 창에서 다시 재야 한다):**

| 쿼리 | Before (실측 2026-08-29) | After (예상) | 절감 |
| --- | --- | --- | --- |
| `realtime_parking_status` upsert | 115,349 | ~54,500 | ~60,800 |
| `discovery_items` upsert | 97,494 | ~13,000 | ~84,500 |
| `discovery_items` 태깅 UPDATE | 21,218 | ~2,000 | ~19,200 |
| detail backfill 선점 UPDATE | 7,118 | 7,118 | 0 |
| 나머지 | 4,939 | 4,939 | 0 |
| **합계** | **246,118** | **~82,000** | **~164,000** |

산출 근거. realtime은 866행 × (24시간 / 30분 heartbeat = 48회) × 1행 = 41,568행에,
값이 실제로 바뀌는 비율 실측(6분 창에서 54/866 = 6.2% → 3분 회차당 약 27건 × 480회 = 12,960)을
더한 값이다. discovery는 하루 안에 다시 들어오는 행 3,101건(2026-08-29 D1 실측)에
heartbeat 24시간 × 3행 = 9,303행과 실제 변경분을 더한 값이다.

**2026-09-01T09:47Z 관측(부분적으로 더러운 창): 상위 10개 합계 58,513행(한도의 59%).**
예상 82,000보다 낮게 나왔다. 내역은 realtime heartbeat UPDATE 29,610행(51%), 좌표 UPDATE
8,794행, realtime INSERT 7,380행, discovery heartbeat 6,597행 순이다. **이 숫자를 확정치로
쓰지 않는다** — 창의 앞 5.7시간이 조건부 쓰기 배포(2026-08-31T15:29Z) 전이라 배포 후 구간만
쌓인 24시간이 아니다. 더 낮게 나올 수도, 버스트가 몰려 더 높게 나올 수도 있다.

**목표(80,000행/일) 대비:** 남은 최대 항목은 realtime heartbeat이고, 더 줄이려면 heartbeat
간격을 늘려야 하는데 그러면 위 순서 계약(heartbeat < 조회 신선도 45분)이 깨져 살아 있는
주차장이 앱에서 사라진다. 조회 신선도 자체를 45분 → 60분으로 늘리는 건 사용자에게 보이는
신선도를 깎는 것이라 숫자를 맞추려고 몰래 할 일이 아니다 — 필요해지면 별도 결정으로 다룬다.

### D1 행 쓰기 24시간 실측 절차

`실측 필요` 상태를 닫으려면 아래를 그대로 한다. **마지막 관련 배포 이후 24시간이 완전히
지난 뒤**에 재야 한다(현재 기준선: 조건부 쓰기 2026-08-31T15:29Z, realtime shard 분할
2026-09-04). 그 전에 잰 창은 배포 전 구간이 섞여 하루치로 환산할 수 없다.

```bash
npx wrangler d1 insights parking-lot-navigator --sort-by writes --limit 10
npx wrangler d1 insights parking-lot-navigator --sort-by reads  --limit 10
```

`--timePeriod` 기본값이 1일(24시간)이다. 출력의 `rowsWritten` 열을 전부 더한 값이 그 창의
상위 10개 합계이고, 100,000과 비교한다. 읽기도 같은 방식으로 5,000,000과 비교한다.

**2026-09-11 현재 이 명령이 실패한다.**

```
Authentication error [code: 10000]
```

wrangler가 OAuth 로그인 토큰으로 `/accounts/<id>/d1/database/<id>` insights 경로를 부를 때
나온다. 그 토큰의 스코프에는 `d1:write`·`workers:write`는 있어도 analytics 읽기가 없다.
insights는 계정 analytics GraphQL을 타므로 **Account Analytics Read 권한이 있는 API 토큰**이
필요하다. Cloudflare 대시보드에서 그 권한의 토큰을 만든 뒤:

```bash
CLOUDFLARE_API_TOKEN=<token> npx wrangler d1 insights parking-lot-navigator --sort-by writes --limit 10
```

토큰 값은 로그·문서·커밋에 남기지 않는다. 대시보드의 D1 → 데이터베이스 → Metrics 화면에서도
같은 24시간 rows written/read를 눈으로 볼 수 있고, 그쪽은 추가 토큰이 필요 없다.

회귀 방지는 테스트에 있다. `worker-backend/tests/fakeD1.ts`가 쓰기 문장 수를 직접 세고,
`discoveryConditionalWrite.test.ts`(같은 항목 100건 × 10 sync = 1,000이 아니라 100),
`realtimeConditionalWrite.test.ts`(같은 주차장 500건 × 20 sync = 10,000이 아니라 1,000),
`taggingFallbackBackoff.test.ts`가 각각 잠근다.

앞으로 늘어날 쪽은 알림 계획이다. 옛 `notification_sends`는 인덱스 3개라 계획 행 1건이 4행
쓰기였고, 계획이 기기 × 행사 조합이라 기기 수에 정비례했다 — 2026-08-28 기준 미래 행사
3,712건 / 서로 다른 시작일 125일(하루 평균 29.7건)이라 기기당 하루 약 90건 = 360행,
기기 100대면 36,000행으로 예산의 3분의 1이 알림만으로 나갔다. migration `0029`가 저장 단위를
`notification_digests`(PK `(device_id, send_day, notification_type)`, **보조 인덱스 없음**)로
바꿔 계획 행 1건 = 2행이고 기기당 하루 최대 3건(D-30/D-7/D-1)이다 — 기기 100대에 하루 약
600행이고, 행사가 하루 몇 건이든 계획 쓰기는 그대로다. 이 테이블에 인덱스를 하나라도
추가하면 그 이득이 바로 깎인다. 지금은 등록 기기가 적어 위 표에 안 잡힌다.

`0027_d1_read_budget_indexes.sql`은 쓰기 쪽에서 `discovery_items` 인덱스를 명시 13개 → 9개로
줄였다(추가 1, 삭제 5). 적용 확인:

```bash
npx wrangler d1 execute parking-lot-navigator --remote \
  --command "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND tbl_name='discovery_items'"
# 11 = 명시 9 + UNIQUE autoindex 2  (2026-08-28 확인)
```

인덱스를 지울 때의 규칙은 `EXPLAIN QUERY PLAN`으로 **실제로 선택되지 않음**을 먼저 보이는 것이다.
옵티마이저는 `ORDER BY`를 공짜로 만족시키는 인덱스를 더 선택적인 인덱스보다 앞세우므로,
`idx_discovery_items_tagging(tagging_version)`처럼 만들어진 뒤 한 번도 안 골라진 인덱스가 생긴다.

## Queue 메시지·operation 예산

Cloudflare Queues 무료 제공량은 **하루 10,000 operations**다. 메시지 하나를 배달하는 데
보통 write 1 + read 1 + delete 1 = **3 op**가 들고(64KB마다 1 op라 우리 메시지는 전부
1 op 단위), **배치 크기는 op 수를 바꾸지 않는다** — `max_batch_size`를 키워도 절약이 없다.
그래서 `wrangler.toml`은 `max_batch_size = 1`이다. 묶어서 아끼는 게 없으니, 대신 메시지마다
CPU 10ms / subrequest 50건 예산을 온전히 준다.

**실질 상한은 하루 약 3,333건**(10,000 ÷ 3)이다. 이 숫자가 "무엇을 메시지 1건으로
쪼갤 수 있는가"를 전부 결정한다.

| 종류 | 하루 메시지 | 근거 |
| --- | --- | --- |
| `discovery-chunk` | 168 | `분 % 9` — 시간당 7회 × 24 |
| `tagging` / `fee-backfill` / `geocode-backfill` / `image-backfill` | 72 × 4 = 288 | `분 % 5`(288회)를 epoch 5분 칸 4분할 |
| `program-select` | 144 | `분 % 10` |
| `program-page` | 576 | 선정 회차마다 최대 `PROGRAM_CRAWL_MAX_ITEMS`(4)건 |
| `program-subpage` + `program-ai` | 최대 1,152 | page 1건이 최악의 경우 둘을 차례로 낳는다 |
| `notification-plan` + `notification-dispatch` | 24 + 48 | 정각 계획, 30분마다 발송(계획 회차는 자기 발송을 직접 넣는다) |
| `local-events` | 24 | `분 === 15` |
| `agent-head` + `agent-image` | 8 + 8 | `분 === 30 && 시 % 3 === 0` |
| `city-festival-site` | 1–10 | 하루 1회 팬아웃, 청크 크기 10 |
| `akei-page` | 최대 30 | 월 3개 × 최대 10페이지(빈 페이지에서 끊는다) |
| `prune-sync-runs` + `prune-analytics` | 2 | 하루 1회 |

- 고정분 **754건**
- **최악 ≈ 2,482건 ≈ 7,446 ops/day (한도의 74%)** — program-page가 전부 subpage와 AI까지 가는 경우
- **현실 ≈ 1,700건 ≈ 5,100 ops/day (한도의 51%)** — 상당수는 랜딩에서 끝나거나 링크가 없다

`PROGRAM_CRAWL_MAX_ITEMS`가 이 예산에서 가장 민감한 손잡이다. **6보다 크게 올리면
재시도 여유가 사라진다** — 소비자가 CPU로 죽으면 `max_retries = 2`만큼 재배달되고,
그 재배달도 op를 쓴다.

**실시간 주차는 Queue를 쓰지 않는다.** 별도 `*/4` Cron이 하루 360회 shard 하나씩 직접
처리한다(`jobs.ts`의 `realtimeShardIndex`). shard가 4개면 전체 순회가 약 16분이고,
Queue 비용은 0이다. dispatch·스냅샷 복구와 invocation을 분리하여 회차마다 CPU·subrequest
예산을 실시간 수집에만 쓴다.

## 유료 플랜으로 풀리는 것

Workers Paid($5/월) 전환 시 subrequest 50 → 1000, CPU 10ms → 30s(설정으로 최대 5분)로
(단 메모리 128MB는 두 플랜이 같다 — 위 절의 `exceededResources` 킬이 메모리라면 유료
전환으로 풀리지 않는다.)
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
