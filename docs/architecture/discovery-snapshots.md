# 일일 행사 스냅샷 / 앱 로컬 조회

작성: 2026-09-13. 상태: `codex/discovery-snapshot-rollout` 검증 브랜치 푸시, 운영 미배포, iOS 기기 검증 전.

## 목적과 범위

D1 무료 일일 읽기 한도 초과로 행사 API가 500을 반환했다. 기존 페이지네이션은 응답 건수만 나누고 페이지마다 넓은 영역을 다시 검색했다. 사용자 수 × 지도 이동 × 레이어 수 × 페이지 수에 따라 읽기량이 증가했다.

새 경로는 다음과 같다.

```text
기존 수집/관리 → D1 → 일일 Queue 내보내기 → R2 완성본 + CDN
                                                   ↓ 버전/변경 파일만
                                        앱 디스크 → 공간 인덱스 → 지도/목록/달력/위젯 동기화
```

- 행사 탐색 요청은 D1을 읽지 않는다. 첫 파일 생성은 여전히 D1을 읽는다.
- 주차 잔여면, 목적지 검색, 신고/관리/결제/알림 서버 작업은 기존 경로를 유지한다. 전체 앱이 서버 없이 작동한다는 뜻은 아니다.
- 수집되지 않은 행사나 잘못된 원본 좌표를 새로 찾아내는 기능은 아니다. RoboCup 같은 원본 수집 범위 문제는 별도다.
- iOS 지도/목록/달력/위젯 동기화의 APIClient가 같은 actor 저장소를 이용한다. 위젯 확장 자체는 기존 App Group 요약 파일을 읽는다.

## 서버 계약

- `GET /api/discovery-snapshot/manifest.json`: schemaVersion, UUID version, generatedAt, parts[{sha256, bytes, count}], count.
- `GET /api/discovery-snapshot/parts/<sha256>.json`: festivals / performanceEvents / localEvents의 공개 DTO. 이미지 바이너리·원본 raw_payload·관리 메모는 포함하지 않는다.
- 같은 파일의 R2 직접 경로는 `discovery/v1/manifest.json`, `discovery/v1/parts/<sha256>.json`이다.
- 인증된 `POST /admin/publish-discovery-snapshot`으로 당일 수정·취소 내용을 재발행한다. DB 수정 완료 후 호출한다. 데이터 완성 전에 공개 manifest를 바꾸지 않는다.
- 자동으로 전체 결과가 0건이 되면 기존 배포를 유지한다. 실제 전부 삭제가 맞다고 확인한 관리자는 `?allowEmpty=true`를 명시해 재발행할 수 있다.
- 공개 파일 전달은 R2만 이용한다. DB 장애 때 D1 API로 우회하지 않는다. 미설정/미생성은 503 + Retry-After, 잘못된 파일 경로는 404다.
- manifest 캐시 5분, 내용 해시 파일 1년 immutable, ETag 지원. Worker 대체 경로는 좌표·검색 파라미터 없는 공통 캐시 키를 사용한다.

## 생성과 일관성

- 매일 KST 10:07 시작, 10:17/10:37은 중단된 체크포인트 복구 확인. 완료된 당일 작업은 D1을 읽지 않고 건너뛴다.
- Queue 한 회차에서 `id > cursor ORDER BY id LIMIT 128`로 원본을 먼저 읽고 그 뒤 필터링한다. 필터 결과가 0건인 페이지도 끝으로 판단하지 않는다. 기본키 검색 계획을 SQLite로 검증했다. 실제 D1 meta.rows_read는 완료 로그에 합산한다.
- discovery_items와 local_events 모두 끝까지 순회한다. pending/rejected 지역 행사, 유효하지 않은 좌표, 기존 정책상 지역 대표 좌표는 공개하지 않는다. 최신 위치를 구하면 다음 배포에 들어온다.
- R2 조건부 쓰기로 중복 Queue 전달의 상태 전진을 하나로 제한한다. send 실패는 예외를 전파해 저장된 체크포인트에서 재시도한다. 2시간 넘은 작업은 배포하지 않는다.
- UUID 버전은 전체 생성이 끝나야 공개된다. 내용 해시가 같은 파일은 서버/앱에서 재사용한다. 다음 전체 버전으로 교체하므로 삭제된 행이 로컬에 계속 누적되지 않는다.
- 이는 **공개 파일의 원자적 교체**다. 여러 D1 쿼리 전체가 한 시점의 DB 트랜잭션인 것은 아니다. 생성 도중 수정·신규 삽입은 다음 배포에 반영될 수 있다. 긴급 변경은 생성 완료 후 재발행하고 실제 결과를 검증한다.
- 안전 예산: 파일 8 MiB, manifest 4 MiB, 전체 인코딩 데이터 128 MiB. 초과 시 일부만 공개하지 않고 배포 실패로 처리한다. 핀 개수 제한이 아니며, 초과 오류는 운영자가 해결해야 한다.

## 앱 동작

- 첫 사용은 전국 파일 전체를 작은 파일 단위로 최대 4개 병렬 다운로드한다. 이후 지도 이동/지역 변경/날짜 필터는 로컬 공간 인덱스로 처리한다. 지역별 온디맨드 다운로드는 이번 구현에 포함하지 않았다.
- 앱 실행 시 저장된 완성본을 먼저 표시한다. 15분 간격 버전 확인으로 당일 재발행도 감지하고, 변경된 해시 파일만 받는다. 새 버전 적용 시 지도·목록·달력 및 위젯 요약을 갱신한다.
- 해시, 바이트 수, 건수, 스키마, 좌표를 검사한다. 파일들을 먼저 저장하고 마지막에 로컬 manifest를 atomic write한다. 다운로드 중 종료·취소·실패 시 기존 완성본을 유지한다.
- 앱 데이터는 Application Support에 보관하고 iCloud 백업에서 제외한다. 성공 후 이전 파일을 정리하고, 다음 시도에서도 쓰이지 않는 중간 파일을 정리한다. 앱 삭제 시 캐시도 삭제된다.
- 지도 요청 하나의 취소가 공통 다운로드를 취소하지 않는다. 초기 실패 후 5분 동안 자동 재시도를 억제하고, 목록의 명시적인 다시 시도는 재검사를 요청한다.
- 날짜/진행 상태는 한국시간으로 재계산한다. 종료된 행사, 기간 불명 지역 행사의 14일 기준, 유료 노출 만료를 다운로드 시점에 고정하지 않는다. 달력의 과거 90일 조회도 유지한다.
- 저장된 데이터 사용/마지막 배포 시각을 지도에 표시한다. 통신이 없어도 이미 받은 핀은 표시되지만, 행사 취소 반영 및 지도 바탕 타일/이미지까지 오프라인을 보장하지는 않는다.
- 최초 설치 + 네트워크 장애에는 저장본이 없어 표시할 수 없다. 최초 다운로드 전에는 준비/오류 안내가 필요하다. 앱에 고정 번들 스냅샷은 넣지 않았다.

## 배포 순서 — 반드시 서버 먼저

1. 별도 R2 `discovery-snapshots` 버킷을 만들고 `DISCOVERY_SNAPSHOTS` 바인딩을 연결한다. wrangler.toml에 정의만 추가했으며 실제 리소스는 생성하지 않았다. D1 신규 마이그레이션은 필요 없다.
2. Worker를 배포하고 관리자 토큰으로 수동 재발행을 요청한다. 큐가 DB 한도 때문에 실패하면 한도 초기화 후 다시 실행한다. 새 앱을 먼저 배포하지 않는다.
3. `snapshot_published` 로그의 rowsRead/count/parts, manifest 시간, 각 파일 HTTP 200/해시/실제 바이트를 확인한다. `snapshot_failed`는 error.message와 cause를 남긴다.
4. 실제 사용자 규모를 위해 R2 커스텀 도메인 + JSON 캐시 규칙을 설정한다. `/discovery/v1/manifest.json`과 `/discovery/v1/parts/*`만 공개하고 build.json 등 그 외 경로는 차단한다. R2 목록 조회를 앱에 열지 않는다. r2.dev는 운영 배포 주소로 쓰지 않는다.
5. Codemagic 환경 변수 `DISCOVERY_SNAPSHOT_BASE_URL=https://<실제-CDN-도메인>/discovery/v1`을 설정한다. 미설정이면 Worker 파일 전달 경로로 동작하지만 Worker 요청 한도는 여전히 소비하므로 큰 규모의 최종 운영 구성으로 간주하지 않는다.
6. XcodeGen/Codemagic에서 iOS unit tests와 빌드를 실행하고 TestFlight에서 아래 검증을 수행한다. 이후 앱을 배포한다. 현재 사용자 승인으로 검증 브랜치만 커밋·푸시했으며 운영 배포/유료 플랜 변경은 하지 않았다.

## 운영 비용·남은 제한

- 새 앱의 지도 이동은 D1 읽기 0을 목표로 한다. 수집기/보강/알림/구버전 앱은 계속 D1을 이용한다. 이들만으로 한도를 초과하는지 별도 관찰해야 한다. 특히 구버전 앱을 이번 코드가 자동으로 전환시키지는 않는다.
- 생성 읽기는 대략 전체 원본 행 수에 비례한다. 인덱스 페이지 읽기·동시 수정·재시도 때문에 정확히 원본 건수와 같다고 가정하지 않는다. R2 작업/저장량, Queue 작업량, Worker 요청량도 별도로 측정한다.
- 해시 파일은 안전을 위해 서버에서 자동 삭제하지 않는다. 무조건 N일 lifecycle을 걸면 오래 유지된 최신 manifest가 참조하는 파일까지 사라질 수 있다. 저장량 알림을 설정하고, 향후 GC는 최신/생성중 manifest 참조 파일과 다운로드 유예기간을 보존하는 mark-and-sweep으로 구현한다. 앱 디스크 정리는 구현되어 있다.
- 초기 전국 다운로드 크기/시간과 기기 최대 메모리는 아직 운영 데이터로 측정하지 못했다. 128 MiB는 허용 크기 안전장치이지 기기 메모리 보장이 아니다. 원본 문자열 디코딩과 구/신 인덱스 동시 보관 때문에 실제 메모리는 더 크다. 배포 전 실측하며 부담이 크면 지역별 팩으로 전환해야 한다.
- 원본 행의 삽입/삭제로 페이지 경계가 바뀌면 여러 파일 해시가 바뀔 수 있다. 레코드 단위 최소 차분이 아니라 **파일 단위 재사용**이다.
- 타 공급자 간 이름/날짜 기반 통합 중복 제거는 별도 문제다. 앱은 동일 ID를 통합하며, 서로 다른 ID를 무리하게 합쳐 실제 행사를 숨기지 않는다.

## 검증

- TestFlight 업로드 전 `node worker-backend/scripts/verify-discovery-snapshot.mjs`가 운영 manifest와 모든 파일을 최대 4개 병렬로 확인한다. 비어 있거나 48시간 초과한 데이터, 해시/건수/좌표/크기 오류, 파일 누락은 업로드를 차단한다. `DISCOVERY_SNAPSHOT_BASE_URL` 또는 `API_BASE_URL`을 사용한다.
- 로컬의 오래된 `worker-backend/src/discoveryCache.js`, `localEvents.js`가 최신 TS를 가리는 문제를 발견했다. 두 파일은 삭제하지 않고 `tmp/stale-source-js-backup-20260913/`로 이동했다. Wrangler build hook이 같은 충돌을 배포 전에 차단한다.

- Worker TypeScript 검사 통과. Worker 38개 파일 / 328개 테스트 통과 (신규 10개 포함).
- Wrangler 실제 배포 없는 번들 검사(`deploy --dry-run`) 통과: gzip 약 287 KiB. 버킷이 실제로 존재하는지/운영 CPU·메모리 한도를 만족하는지까지 증명하는 검사는 아니다.
- 테스트: 기존 600개 상한 초과, 필터로 비는 첫 페이지 이후 항목, PK 검색 계획, Queue 재전송/CAS, 공개 전 실패, D1 장애 중 파일 제공, 삭제 반영, 동일 해시 재사용, 비공개 경로, 당일 재발행.
- iOS 회귀 테스트 추가: 750개 핀/다른 지역 이동 시 추가 통신 없음, 동시 요청 합치기, 취소 격리, 재실행 오프라인, 중간 파일 실패 시 기존 manifest 유지, 삭제 반영, 해시/건수 오류, 빈 정상 결과, 재시도 억제, KST 자정/공간 경계.
- Codemagic 빌드 `6aa57dd96c12c2db73677831`에서 iOS 컴파일 및 단위 테스트 92개 통과. 핵심 UI 5개 중 4개 통과, 서버 행사 목록이 필요한 상세/즐겨찾기 1개 skip. 캡처 도구 1개도 실행됐으나 검증으로 집계하지 않으며 다음 일반 CI부터 제외한다.
- 실기기·전국 운영 데이터 검증은 미수행. TestFlight 필수: 최초 설치·저속 통신·앱 종료 후 재개·업데이트 중 지도 이동·새 버전 삭제/취소·공연/박람회/지역 행사 필터·날짜 변경·실시간 주차·위젯·동작 줄이기·마스코트 표시 종료.

참고: [Cloudflare R2 CDN](https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/), [Workers 운영 가이드](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/), [R2 조건부 쓰기](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), [iOS 백그라운드 갱신](https://developer.apple.com/documentation/backgroundtasks/choosing-background-strategies-for-your-app).
