# 축제 "지역행사" 카테고리 신설 설계

날짜: 2026-08-08

## 배경

사용자 요청: "행사, 박람회도 표시하길 원함 (필요시 소스 채택)". 범위 확인 결과 (1) 지역/문화 축제성 행사, (2) 산업/상업 박람회(코엑스·킨텍스·벡스코 등) 둘 다 원하며 우선순위는 무관. 두 하위 문제의 크기 차이가 커서 별도 스펙/플랜 사이클로 분리하기로 하고, 이번 스펙은 (1)번만 다룬다. (2)번(산업/상업 박람회를 위한 신규 데이터 소스 조사)은 별도 프로젝트로 이후 진행한다.

기존 상태 조사 결과, TourAPI 축제 provider들(`TourApiFestivalProvider`의 `searchFestival2`, `TourApiAreaFestivalProvider`의 `areaBasedList2`)은 `contentTypeId=15`(축제/공연/행사) 범위에서 `cat3` 제한을 걸지 않으므로, 관광공사가 "행사"로 등록한 지역/문화성 항목은 이미 수집되고 있을 가능성이 높다. 문제는 수집이 아니라 **분류**다: `shared-types/src/discover.ts`와 `worker-backend/src/llmTaggingSchema.ts`의 `FESTIVAL_PRIMARY_CATEGORIES`(10개 테마 + etc)에는 "박람회/행사"류에 대응하는 카테고리가 없어 전부 `etc`로 뭉뚱그려진다.

`FestivalPrimaryCategory` 분류는 수집 시점이 아니라 별도 태깅 파이프라인(`worker-backend/src/llmTagging.ts`)이 사후에 수행한다. 주 경로는 Cloudflare Workers AI LLM(`llama-3.3-70b-instruct-fp8-fast`)이고, AI 바인딩이 없거나 호출이 실패했을 때만 `worker-backend/src/llmTaggingFallback.ts`의 정규식 규칙(`FESTIVAL_RULES`)으로 폴백한다.

## 목표

- 기존 10개 테마(음악·공연/먹거리/자연·꽃/불꽃·야경/전통·문화/가족·키즈/마켓·플리마켓/스포츠·아웃도어/영화·미디어/예술·전시) 어디에도 맞지 않지만 박람회·엑스포·컨벤션류로 식별 가능한 지역/문화 축제 항목에 새 카테고리 "지역행사"(`general_event`)를 부여한다.
- iOS 필터 칩/지도 핀에 "지역행사" 카테고리가 노출되어 사용자가 명시적으로 필터링할 수 있게 한다.
- 이미 `etc`로 굳어버린 과거 데이터도 배포 직후 백필로 재분류한다.
- "행사"라는 범용 단어 자체는 매칭 신호로 쓰지 않는다 — 거의 모든 축제 설명문에 등장해 과대분류(false positive)를 유발하기 때문. (직전에 고친 축제 dedup 유사도 오탐 버그와 같은 종류의 실수를 반복하지 않는다.)

## 비목표

- 산업/상업 박람회(코엑스·킨텍스·벡스코 등 B2B 전시)를 위한 신규 데이터 소스 통합. 별도 스펙에서 다룬다.
- TourAPI `cat3` 코드(`A02070100` 등)를 분류 신호로 사용하는 것 — 정확한 한글 라벨 매핑을 이번 세션에서 검증하지 못해 채택하지 않는다.
- 로컬 매장 이벤트(`LocalEventPrimaryCategory`, `local_events` 도메인) 변경. 이번 작업은 축제(festival) 도메인에만 적용된다.

## 카테고리 정의

- slug: `general_event`
- 한국어 라벨: **"지역행사"**
- 적용 대상: 이미 수집 중인 TourAPI 축제 데이터 중 기존 10개 테마에 해당하지 않으면서 박람회·엑스포·컨벤션류 신호가 있는 항목.
- `etc`는 그대로 유지한다 — 정말 분류 신호가 없는 항목의 최종 폴백. 정규식 기반 폴백 경로는 매칭 범위가 좁아 `etc`에 남는 항목이 계속 있을 수 있고, LLM 경로는 문맥을 더 넓게 판단하므로 상대적으로 더 많이 잡아낼 것으로 기대한다.

## 변경 사항

### 1. `shared-types/src/discover.ts`

`FESTIVAL_PRIMARY_CATEGORIES` 배열에 `general_event`를 `art_exhibition` 다음, `etc` 이전에 추가한다.

### 2. `worker-backend/src/llmTaggingSchema.ts`

- `FESTIVAL_PRIMARY_CATEGORIES` 배열을 1번과 동일하게 동기화한다(두 파일이 독립적으로 선언되어 있으므로 반드시 함께 수정).
- `FESTIVAL_GUIDE`에 다음 항목을 `art_exhibition` 항목 다음, `etc` 항목 이전에 추가한다:
  ```
  - general_event: 박람회, 엑스포, 취업박람회, 산업전, 무역전, 컨벤션, 총회 등 산업·행사성 모임. 위 테마(공연/먹거리/꽃/야경/전통/가족/마켓/스포츠/영화/전시)에 해당하면 그쪽을 우선한다.
  ```

### 3. `worker-backend/src/llmTaggingFallback.ts`

`FESTIVAL_RULES` 배열에서 `art_exhibition` 규칙(`/미술|사진|조각|디자인|공예|전시|exhibition/i`)보다 **앞에** 새 규칙을 추가한다. 순서가 중요한 이유: "산업박람회" 같은 제목이 "전시"라는 단어 때문에 art_exhibition으로 먼저 매칭되는 것을 막기 위해서다.

```ts
{ pattern: /박람회|엑스포|expo|무역전|산업전|취업박람회|잡페어|job\s*fair|컨벤션|convention/i, category: "general_event", tag: "박람회" },
```

"행사"라는 단어 자체는 패턴에 넣지 않는다. 이 함수는 title+subtitle+categoryText+benefit+description+tagsHint 여섯 필드를 합친 문자열(`fallbackTag()` 내 `text` 변수)에 대해 매칭하므로, 필드 범위 자체는 이미 넓다.

### 4. iOS — `ios-app/Core/Models/DiscoverCategories.swift`

`FestivalPrimaryCategory` enum에 새 case를 `artExhibition` 다음, `etc` 이전에 추가하고 4개 computed property(`displayName`, `systemImage`, `tint`, `emoji`)에 각각 분기를 추가한다.

```swift
case generalEvent = "general_event"
```

- `displayName`: `"지역행사"`
- `systemImage`: `"megaphone.fill"`
- `tint`: 기존 10개 색상과 겹치지 않는 색상 신규 배정 (예: `Color(red: 0.271, green: 0.427, blue: 0.663)` — 톤 조정은 구현 단계에서 확정)
- `emoji`: `"📢"`

`FilterSheetView`(필터 칩 목록)와 `MapPinRenderer`(지도 핀 매핑)는 `FestivalPrimaryCategory.allCases`를 순회하는 구조이므로 case 추가만으로 대부분 자동 반영되지만, 구현 단계에서 두 파일을 열어 하드코딩된 case 분기가 없는지 grep으로 재확인한다.

`ios-app/project.yml`의 `CURRENT_PROJECT_VERSION`을 196 → 197로 올린다.

### 5. 배포 후 백필

배포 직후 `POST /admin/run-tagging-backfill`(`worker-backend/src/index.ts:936`, 기존 admin 토큰 인증 재사용)을 호출해 기존 festival 데이터를 전부 재태깅한다. 이 엔드포인트는 `mode: "backfill"`로 `runTagging`을 실행하며 `WHERE type = 'festival'` 조건으로 `tagging_version` 값과 무관하게 전체 행을 다시 LLM에 태운다.

이유: incremental 태깅(정기 sync에 연결된 경로)은 `tagging_version = 0 OR tagging_version = -1`인 행만 처리한다(`worker-backend/src/llmTagging.ts` `fetchFestivalRows`). 이미 LLM이 성공적으로 분류해 `tagging_version = 1`이 찍힌 기존 `etc` 항목은 카테고리를 추가해도 정기 sync로는 재분류되지 않는다. 백필을 돌려야 과거 데이터에도 새 카테고리가 반영된다.

`max_rows` 기본값이 500이므로, 전체 festival 행 수가 500을 넘으면 여러 번 호출하거나 `max_rows` 쿼리 파라미터를 키워서 호출한다. 실제 festival 행 수는 배포 시점에 D1에서 확인한다.

## 테스트

- `llmTaggingFallback` 매칭 테스트 추가:
  - "OO박람회", "OO엑스포" 같은 제목 → `general_event`로 분류.
  - "OO 행사"처럼 신호 단어가 "행사"뿐인 제목 → 여전히 `etc` (과대분류 방지 회귀 테스트로 명시).
  - "산업박람회 및 전시" 같은 제목 → `general_event` (art_exhibition보다 우선 매칭 확인, 규칙 순서 회귀 테스트).
- `shared-types`와 `llmTaggingSchema.ts`의 `FESTIVAL_PRIMARY_CATEGORIES` 배열이 동일한 값 집합을 갖는지 확인하는 테스트(기존에 유사 테스트가 있으면 재사용, 없으면 신규 추가).

## 배포 절차

1. `pnpm -C worker-backend typecheck`
2. `pnpm --filter @parking/backend test`
3. `worker-backend` deploy
4. `POST /admin/run-tagging-backfill` 호출(필요 시 `max_rows` 조정하며 반복)로 기존 데이터 재분류
5. iOS: `CURRENT_PROJECT_VERSION` 197로 올린 상태로 Codemagic/Xcode 빌드 (Swift 파일 변경이 있으므로 필수)

## 영향받지 않는 것

- 로컬 매장 이벤트(`LocalEventPrimaryCategory`) 스키마·규칙.
- 축제 dedup 로직(`discoveryCache.ts`의 `belongsToFestivalCluster`) — 이번 작업과 무관.
- `TAGGING_VERSION` 상수 자체는 그대로 둔다(값을 올려도 incremental 쿼리 조건과 무관하므로 효과가 없다 — 백필을 별도로 트리거하는 것이 유일한 재분류 경로).
