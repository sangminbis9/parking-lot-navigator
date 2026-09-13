# 도메인 없는 행사 정적 배포

2026-09-13 사용자가 혼합 방식을 선택했다. `workers.dev/legal/support`는 R2 커스텀 도메인으로 사용할 수 없다. 도메인 구매/유료 전환/비공개 R2 공개 없이, **행사 파일만 Workers Static Assets**, 실시간 주차는 기존 Worker + R2 공유 캐시를 사용한다.

## 데이터 흐름

기존 수집 → D1 변경 묶음 발행 → 비공개 R2 → 공개 DTO API → GitHub 발행기 → 정적 파일 주소 → 앱 디스크/로컬 검색.

- 앱 행사 주소: `https://parking-lot-navigator-data.parkingnav.workers.dev/discovery/v1`
- 기존 API/지원 페이지 주소는 유지한다. 주차 요청 한도까지 없어진 것은 아니다.
- 정적 서비스는 API 코드·D1/R2 바인딩·시크릿을 사용하지 않는다. 파일에 일치하는 요청은 API Worker를 실행하지 않는다.
- `.github/workflows/publish-discovery-assets.yml`: 5분 간격 변경 확인, 변경 또는 10분 상태 heartbeat 시 배포. 예약 실행 지연/누락 가능성이 있어 즉시 발행 보장은 없다. 사장님 이벤트도 이 추가 지연을 가진다.
- 공개 저장소의 표준 Ubuntu runner만 사용한다. Actions cache/artifact는 만들지 않는다. 도메인 비용/추가 플랜 없음. 저장소가 비공개로 바뀌면 발행 job을 건너뛴다.

## 안전장치와 비용

- 원본 manifest/status 두 요청으로 상태 확인. 변경 없는 신규 검사에는 파일 전체 다운로드 없음.
- 전체 현재 데이터 및 직전 배포의 파일을 검증한다. 같은 해시 파일은 기존 정적 주소에서 읽고, **새 해시 파일만 API Worker에서 읽는다**. 파일 검증은 병렬 4개, 크기/해시/건수/좌표/공개 계약 검사 후 배포한다.
- 원본 발행 장애·손상·빈 결과·버전 역전이면 배포하지 않아 기존 정적 파일을 보존한다. 전체 배포가 완료되기 전 URL을 새 파일 집합으로 바꾸지 않는다.
- manifest/status와 알려진 공개 parts만 수집한다. 버킷 나열·내부 상태/예산 복사 없음. 직전 파일은 전환 도중 이전 manifest를 읽은 앱을 위해 보존하며 그보다 오래된 파일은 다음 배포에서 제외한다.
- 128MiB/9,000파트 안전 예산 초과 시 **업데이트 전체를 실패 처리**한다. 일부 핀을 잘라서 발행하지 않는다. 확대 시 지역 묶음 설계를 별도로 검토한다.
- Worker 요청이 사라지는 것은 **새 빌드의 행사 파일 조회**에 한정된다. 구버전 앱·주차·검색·상세 API·수집은 기존 한도에 포함된다. 원본 Worker가 제한되면 새 정적 발행도 대기하지만 기존 정적 행사 파일은 계속 제공된다.
- `r2.dev`는 개발용 제한이 있어 프로덕션 대체로 활성화하지 않았다.

## 검증/배포

1. `node --test worker-backend/scripts/prepare-static-snapshot.test.mjs`
2. `node worker-backend/scripts/prepare-static-snapshot.mjs` 실행 결과 `changed=true`의 `directory`를 확인한다. 최초 서비스가 없을 때만 `--bootstrap` 사용.
3. `wrangler deploy --config worker-backend/wrangler.assets.toml --assets <검증된 directory>`
4. `DISCOVERY_SNAPSHOT_BASE_URL`을 정적 주소로 지정하여 `verify-discovery-snapshot.mjs` 실행. 전체 파일 검사 및 내부 경로 404 확인.
5. CI/Codemagic의 동일 환경변수로 새 앱 빌드. 기존 TestFlight 261은 아직 Worker 주소를 쓴다.

최초 정적 배포: `6f3195de-cc89-490f-af6c-5f69fd6308a8`, 데이터 revision 155 / 12,669항목 / 167파트 / 11,500,570바이트 검증 통과. 자동 발행 CI 및 새 iOS 빌드 결과는 PROJECT_STATE에 별도 기록한다.

## 별도 남은 원본 누락 과제

- 지자체 130개 소스가 10개/일 순환이면 재방문 약 13일. Queue·geocode 예산을 다시 계산하여 짧은 슬롯으로 분산해야 한다.
- IFEZ 목록 첫 페이지만 읽는 구조와 파서 탈락 사유 미집계 보완.
- `cityFestivalCache.ts`의 500개 결과/5,000개 선조회 한도가 원본 전달을 자를 가능성 검증 및 페이지 순회 전환. 정적 배포는 원본에 없는 행사를 새로 만들지 않는다.
- RoboCup 2026은 공식 공개 행사 7월 2–6일로 이미 종료. 당시 수집 누락과 현재 날짜 필터를 구분하고 공식 주최/행사장 소스의 지속 수집 가능성을 검증해야 한다.

공식 근거: [Static Assets 비용](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [업로드/배포 계약](https://developers.cloudflare.com/workers/static-assets/direct-upload/), [GitHub Actions 비용](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [예약 실행 한계](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
