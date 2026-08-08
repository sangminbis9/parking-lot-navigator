# 산업/상업 박람회(Trade Expo) 데이터 소스 설계

## 배경

기존 "행사, 박람회도 표시하길 원함" 요청을 분석한 결과, 두 개의 독립된 sub-project로 분리하기로 합의했다.

1. 지역/문화 축제성 행사 — `general_event` 카테고리로 완료됨 (`docs/superpowers/plans/2026-08-08-festival-general-event-category.md`)
2. 산업/상업 박람회 (코엑스·킨텍스·벡스코 등 전시컨벤션센터에서 열리는 무역박람회, 취업박람회, 산업전시회) — 이 문서의 대상

기존 TourAPI festival provider(`searchFestival2`/`areaBasedList2`, `cat2=A0207`)는 관광공사 문화관광축제 데이터 위주라 산업/상업 박람회는 커버하지 못한다는 가설을 세우고 실제 대안 데이터 소스를 조사했다.

## 데이터 소스 조사 결과

**공공데이터포털 계열 3곳을 확인했으나 모두 부적합했다.**

- 산업통상부_전시사업(국내 전시회) — 정적 CSV 파일을 연 1회만 갱신, 좌표 정보 없음. "다가오는 근처 박람회"를 보여주는 용도로는 갱신 주기가 너무 느리다.
- 문화체육관광부_12개 기관 전시정보 API — 실제 API이지만 국립현대미술관·국립어린이청소년도서관·대한민국역사박물관 등 문화예술 전시 전용. 코엑스/킨텍스/벡스코 무역박람회는 대상 외.
- GEP(글로벌전시포털) API — 한국 기업의 해외 전시 참가 정보용. 국내 전시장 일정과 무관.

**스크래핑 후보 두 방향을 비교했다.**

- 개별 전시장 직접 스크래핑(코엑스/킨텍스/벡스코 각 사이트) — 오늘 완료된 `cityFestivalDiscovery.ts`와 같은 패턴으로 구현 가능하지만, 전시장 수만큼 유지보수 부담이 늘어난다.
- 통합 아그리게이터 스크래핑 — 한국전시산업진흥회(AKEI, 공식 산업 협회)와 MICE365(민간 3rd-party, 코엑스·킨텍스·벡스코·AT Center·SETEC·EXCO·송도컨벤시아까지 7곳 이상 커버) 두 곳을 확인.

**결론: AKEI(한국전시산업진흥회) 단일 아그리게이터를 채택한다.** 공신력 있는 단일 소스이며 유지보수 부담이 최소다. MICE365 대비 커버리지는 좁을 수 있으나, 민간 상업 사이트의 이용약관 리스크를 피할 수 있다.

`robots.txt` 확인 결과 `www.akei.or.kr`은 `/AKEI_admin/`만 차단하고 `/bbs/board.php`(일정 게시판) 경로는 크롤링 제한이 없다.

## AKEI 페이지 구조

- 목록 페이지(`/bbs/board.php?bo_table=schedule`): 전시회명(한글/영문), 주최기관, 개최기간(`YYYY-MM-DD~YYYY-MM-DD`), 개최 장소(전시장명 텍스트, 예: "코엑스(COEX)", "킨텍스(KINTEX)", "송도컨벤시아") 표시. 하단에 번호 페이지네이션.
- 상세 확장 섹션: 전시회명(한글/영문/약칭), 주최/기간/장소, 전시분야 분류번호, 홈페이지 링크, 세부품목, 연락처.
- **좌표·정확한 주소 정보는 제공되지 않는다.** 전시장명만 텍스트로 표기된다.

## 아키텍처

새 스크래퍼 `worker-backend/src/akeiTradeExpoDiscovery.ts`를 `cityFestivalDiscovery.ts`와 동일한 패턴으로 만든다. AKEI 일정 게시판을 페이지네이션 따라가며 파싱하고, `discovery_items` 테이블에 `type='festival'`, `source='akei_trade_expo'`로 upsert한다.

### `primary_category`를 LLM 태깅 없이 즉시 확정

이 소스에서 들어오는 항목은 정의상 전부 산업/상업 박람회이므로, 제목 키워드로 LLM/fallback이 추측할 필요 없이 수집 시점에 `primary_category='trade_expo'`를 바로 쓴다. `tagging_version`도 처음부터 확정값(`TAGGING_VERSION`)으로 써서 이후 backfill/incremental 태깅 루프가 이 행들을 다시 건드리지 않게 한다. KOPIS 공연 데이터가 `source='kopis'`로 이미 분류가 확정된 채 들어오는 것과 같은 방식이다.

### 전시장 좌표 — 지오코딩 대신 하드코딩 매핑 테이블

국내 대형 전시장은 코엑스·킨텍스·벡스코·송도컨벤시아·aT센터·SETEC·EXCO 등 10곳 미만으로 고정돼 있다. `worker-backend/src/exhibitionVenues.ts`에 전시장명(한글/영문/약칭 변형 포함) → `{lat, lng, address}` 매핑을 하드코딩한다.

- 정확 일치 실패 시 부분 문자열 포함 매칭을 시도한다 (예: "코엑스 제1전시장" → "코엑스" 키로 매칭).
- 매핑에 없는 전시장명이 나오면 그 행은 버리고 `console.warn`으로 로그만 남긴다. 로그를 근거로 매핑 테이블을 점진적으로 넓힐 수 있다.
- `NationalCultureFestivalProvider`처럼 매 행마다 Kakao geocoding API를 호출하는 방식보다 단순하고, 외부 API 실패에 영향받지 않아 안정적이다.

### 스케줄링 — 새 cron 추가 없음

`worker-backend`의 Cloudflare Workers 계정은 스크립트당 cron trigger 5개 한도이며 현재 정확히 5개가 다 차 있다 (`*/3 * * * *` 주차장 동기화, `*/9 * * * *` discovery chunk, `15 * * * *` 로컬 이벤트 동기화, `30 */3 * * *` agent office, `*/20 * * * *` tagging). 도시 축제 스크래퍼가 `15 * * * *` cron 핸들러 안에 `scheduledAt.getUTCHours() === 4` 가드를 얹어 하루 1회로 재사용한 것과 같은 방식으로, `hour === 5` 가드를 추가해 같은 트리거를 재사용한다.

### 카테고리/UI — `general_event` 패턴 반복

`shared-types`의 `FestivalPrimaryCategory`에 `trade_expo`를 추가하고, iOS `DiscoverCategories.swift`·`Features/Map/MapPinRenderer.swift`·필터 UI에 동일 패턴으로 반영한다. `general_event` 추가 작업(오늘 완료)이 사실상 템플릿이므로 이 부분의 구현 리스크는 낮다.

## 데이터 흐름

1. **cron 트리거** (`worker-backend/src/index.ts`의 `scheduled()`): `15 * * * *`가 발화될 때 `scheduledAt.getUTCHours() === 5`면 `runAkeiTradeExpoDiscovery(env)` 호출 (city-scraped의 `hour===4` 블록 옆에 추가).
2. **스크래핑**: AKEI 일정 게시판 첫 페이지부터 순서대로 fetch. 한 페이지에서 파싱된 행이 0개거나 이미 DB에 있는(최근 본) 항목만 나오면 조기 종료 — 매번 전체를 다시 긁지 않는다.
3. **행 파싱**: 각 행에서 전시회명·주최기관·기간·전시장명 텍스트를 추출한다. 1차 구현은 목록 페이지 필드만으로 진행하고(YAGNI), 상세 페이지의 홈페이지 URL·세부품목 보강은 필요해지면 이후 추가한다.
4. **전시장 매핑**: 파싱된 전시장명을 `exhibitionVenues.ts` 매핑 테이블에 대조해 좌표를 확정하거나 skip한다.
5. **upsert**: `discovery_items`에 `id`(제목+기간+전시장 기반 결정적 해시, `national_culture` 패턴과 동일), `type='festival'`, `source='akei_trade_expo'`, `primary_category='trade_expo'`, 확정된 `tagging_version`으로 upsert한다.
6. **조회**: `queryAkeiTradeExposFromCache(db, lat, lng, radiusMeters, upcomingWithinDays)`가 `queryCityFestivalsFromCache`와 동일한 시그니처로 `/api/festivals`가 쓰는 쿼리 경로에 자연스럽게 합류한다. 앱은 기존 festival 카드/지도 핀 렌더링 경로를 그대로 쓴다.

## 에러 처리

개별 실패가 전체 sync를 죽이지 않도록 best-effort로 처리한다.

- 페이지 fetch 실패(네트워크/5xx) → 해당 지점에서 조기 종료 (과거 페이지일수록 최신 데이터가 아니므로 이후 페이지를 계속 시도하지 않는다)
- 행 파싱 실패(예상 못한 HTML 구조) → 그 행만 skip, 카운터로 집계해 로그
- 전시장명 매핑 실패 → 그 행만 skip + 로그 (매핑 테이블 보강 신호로 활용)
- D1 upsert 실패 → 해당 배치만 실패 처리, 나머지 배치는 계속 진행 (`writeResults`의 배치 처리 패턴과 동일)
- cron 트리거 자체 실패는 다음 `15 * * * *` 사이클에서 자연 재시도 (별도 재시도 로직 불필요)

## 테스트

- **파서 단위 테스트**: AKEI 목록 페이지 HTML 픽스처를 넣고 제목/기간/전시장명 파싱, 페이지네이션 링크 인식을 검증한다.
- **전시장 매핑 단위 테스트**: "코엑스", "COEX", "코엑스 제1전시장", 매핑에 없는 임의 문자열 각각에 대해 올바른 좌표 반환/skip 여부를 검증한다.
- **discovery 통합 테스트**: `cityFestivalDiscovery.test.ts` 패턴을 따라 fetch를 mock하고 `runAkeiTradeExpoDiscovery`가 정상 케이스·페이지 실패·페이지네이션 조기종료 케이스에서 올바르게 동작하는지 검증한다.
- **카테고리 회귀 테스트**: `trade_expo`가 `FestivalPrimaryCategory`·iOS enum·핀 렌더러에 정상 반영됐는지 검증한다 (`general_event`와 동일한 테스트 스타일).

## 범위 밖

- 상세 페이지 크롤링(홈페이지 링크, 세부품목) — 목록 페이지 필드만으로 1차 구현 범위를 제한한다.
- MICE365 등 민간 아그리게이터 — AKEI 단일 소스로 충분치 않다고 판단되면 별도 spec으로 재검토한다.
- 전시장 매핑 테이블의 완전성 — 최초 구현은 주요 10곳 미만으로 시작하고, 운영 중 로그로 누락된 전시장을 발견하면 점진적으로 추가한다.
