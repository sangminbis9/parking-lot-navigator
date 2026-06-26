# 공연 기능 (Performance Feature) 설계

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** KOPIS 공연 데이터(source=kopis)와 음악·공연 카테고리 축제(primaryCategory=music_performance)를 "공연" 기능으로 묶어, 달력 탭 섹션과 지도 레이어 두 곳에 노출한다.

**Architecture:** 기존 D1 discovery_items 파이프라인을 그대로 사용하고 KOPIS 수집 페이지만 100까지 늘린다. 새 `/api/performances` 엔드포인트가 D1에서 source='kopis' 이벤트 + primary_category='music_performance' 축제를 각각 조회해 합친 응답을 반환한다. iOS는 새 PerformanceItem union 타입으로 두 종류를 통합 표시한다.

**Tech Stack:** Cloudflare Worker (Hono), D1, SwiftUI iOS 16+, XcodeGen, shared-types TypeScript

---

## Global Constraints

- iOS 최소 지원 버전 16+, SwiftUI
- Worker: Hono + D1, TypeScript strict
- 새 D1 테이블 추가 없음 — discovery_items 재활용
- KOPIS API 일일 한도 10,000회; 설계 후 일일 예상 호출 ~2,670회 (26.7%)
- 공연은 달력에서 "기존 축제와 별개 섹션"으로 표시 (중복 노출 허용)
- 지도 마커 색상: #E63946 (musicPerformance tint), SF Symbol: music.note
- 기존 코드 패턴(APIClient protocol method, DiscoveryQueryOptions, mapEventRow/mapFestivalRow) 그대로 따름

---

## KOPIS 페이지 한도 및 한도 초과 처리

### 수집 설정 변경

| 변수 | 현재 | 변경 후 |
|---|---|---|
| `KOPIS_MAX_PAGES` | `"2"` | `"100"` |
| `KOPIS_DETAIL_MAX_ITEMS` | `"10"` | `"50"` |

**일일 API 호출 계산:**
- 1회 sync당: 100 목록 페이지 + 50 상세 = 최대 150회
- 단, KOPIS 목록은 전국 공통 → 첫 번째 도시 호출이 실제 fetch, 나머지 16개 도시는 인스턴스 캐시 히트
- sync 빈도: 81분마다 1회 → 하루 17.8회
- **일일 최대: 150 × 17.8 ≈ 2,670회 → 한도의 26.7%**
- 실제는 더 적음: KOPIS 전국 공연 목록이 3,000건 미만이면 30페이지에서 이른 break

### 한도 초과 시 처리 (`KopisEventProvider.fetchPage`)

HTTP 429 응답을 수신하면 빈 배열을 반환한다. `fetchAllItems`의 기존 루프는 "반환 항목이 `EVENT_PAGE_SIZE(100)` 미만이면 break" 로직으로 이미 동작하므로, 429 → `[]` 반환 → 0 < 100 → break로 자연스럽게 조기 종료된다.

```typescript
// fetchPage 내부
if (response.status === 429) {
  console.warn("KOPIS rate limit hit, stopping pagination early");
  return [];  // triggers early break in fetchAllItems loop
}
if (!response.ok) throw new Error(`KOPIS API failed: ${response.status}`);
```

**결과:** 429 발생 시 그 시점까지 수집한 데이터를 D1에 upsert하고 종료. D1의 45일 stale 임계값 덕분에 이전 sync 데이터가 유효하게 유지되므로 사용자 화면에는 영향 없음.

---

## 데이터 흐름

```
KOPIS API ──────────────────────────────────────────────┐
(81분마다, 최대 100페이지 = ~5,000건)                    │
                                                         ▼
TourAPI 등 ──────────────────────────────────────────▶  D1 discovery_items
(기존 sync, primary_category='music_performance')        │
                                                         ▼
                                          /api/performances?lat=&lng=&...
                                                         │
                                     ┌───────────────────┴──────────────────┐
                                     ▼                                       ▼
                            CalendarTabView                          MapHomeView
                            공연 섹션 (선택 날짜별)                  공연 레이어 (핀)
```

---

## 파일 구조

**변경 파일:**

- `wrangler.toml` — KOPIS 수집 설정 증대
- `backend/src/features/discover/events/KopisEventProvider.ts` — 429 처리
- `worker-backend/src/discoveryCache.ts` — `queryPerformancesFromCache()` 추가
- `worker-backend/src/index.ts` — `/api/performances` 라우트 추가
- `shared-types/src/discover.ts` — `DiscoverPerformancesResponse` 타입 추가
- `ios-app/Core/Networking/APIClient.swift` — `nearbyPerformances()` 추가
- `ios-app/Core/Models/DiscoverItem.swift` — `PerformanceItem` enum + response struct
- `ios-app/Features/Calendar/CalendarTabView.swift` — 공연 섹션 추가
- `ios-app/Features/Map/MapHomeView.swift` — 공연 레이어 토글 추가
- `ios-app/Features/Map/MapHomeViewModel.swift` — 공연 레이어 로딩

---

## 인터페이스 정의

### shared-types 추가 타입

```typescript
export interface DiscoverPerformancesResponse {
  festivals: Festival[];   // primary_category='music_performance'
  events: FreeEvent[];     // source='kopis'
  generatedAt: string;
}
```

### Worker API

```
GET /api/performances
  ?lat=<number>
  &lng=<number>
  &radiusMeters=<number>     (optional, default 50000)
  &upcomingWithinDays=<0-365> (optional, default 365)

Response: DiscoverPerformancesResponse
```

### iOS APIClient 프로토콜

```swift
func nearbyPerformances(
  lat: Double,
  lng: Double,
  radiusMeters: Int,
  upcomingWithinDays: Int
) async throws -> (festivals: [Festival], events: [FreeEvent])
```

### iOS PerformanceItem

```swift
enum PerformanceItem: Identifiable {
    case festival(Festival)
    case event(FreeEvent)

    var id: String {
        switch self {
        case .festival(let f): return "festival-\(f.id)"
        case .event(let e): return "event-\(e.id)"
        }
    }
    var presentation: DiscoverPresentation {
        switch self {
        case .festival(let f): return f.discoverPresentation
        case .event(let e): return e.discoverPresentation
        }
    }
    var startDate: String {
        switch self {
        case .festival(let f): return f.startDate
        case .event(let e): return e.startDate
        }
    }
    var lat: Double { ... }
    var lng: Double { ... }
}
```

---

## 달력 탭 — 공연 섹션

CalendarTabView의 agendaSection 아래에 새 `performanceSection` 추가. 기존 축제 어젠다와 나란히 배치:

```
[캘린더 그리드]
[즐겨찾기 축제 어젠다 (기존)]
────────────────────
[근처 공연 · N개]           ← 신규
  [공연 카드 (AgendaRow 스타일)]
  ...
```

- `PerformanceViewModel(apiClient: apiClient)`: `@StateObject`로 CalendarTabView의 `init` 내 생성 (CalendarViewModel과 동일한 패턴)
- 날짜 선택 시 `selectedDay` 기준으로 `startDate..endDate` 범위가 겹치는 공연 필터링
- 로딩/에러 상태 처리
- 탭할 때 기존 `router.showResults(for: destination, presentation: presentation)` 재사용

---

## 지도 레이어

MapHomeView의 레이어 토글 버튼 영역에 공연 버튼 추가. 기존 축제 토글과 같은 패턴:

```swift
// MapHomeView discoverLayerToggles
layerToggleButton(
    icon: "music.note",
    color: Color(red: 0.902, green: 0.224, blue: 0.275), // #E63946
    isOn: viewModel.showsPerformanceLayer,
    hasData: !viewModel.performanceMapItems.isEmpty
) {
    viewModel.togglePerformanceLayer(viewport: mapViewport)
}
```

MapHomeViewModel 추가 항목:
- `@Published var showsPerformanceLayer = false`
- `@Published var performanceMapItems: [PerformanceItem] = []`
- `func loadPerformanceLayer(viewport: MapViewport)` — `nearbyPerformances()` 호출 후 `performanceMapItems` 업데이트
- `func togglePerformanceLayer(viewport: MapViewport)` — 토글 시 로드, 해제 시 배열 비움

**지도 핀 처리:**
공연 레이어는 `/api/map/items`를 거치지 않고 `/api/performances`에서 직접 로드한다 (`MapItem` 타입 변경 없음). `MapHomeViewModel`이 `PerformanceItem` 배열을 `MapPinItem`으로 변환해 기존 축제 핀과 동일한 방식으로 지도에 추가한다. 핀 색상은 `FestivalPrimaryCategory.musicPerformance.tint` (#E63946)를 사용해 기존 핀 렌더링 코드를 재활용한다.

---

## 검증 기준

**Worker:**
```bash
pnpm -C worker-backend typecheck
```

**iOS:**
- XcodeGen으로 프로젝트 파일 재생성 불필요 (Swift 파일 추가 없음, 기존 파일 수정만)
- 빌드번호 변경 없음 (UI 기능 추가이므로 배포 시 올림)

**수동 확인:**
- `/api/performances` 응답에 festivals, events 배열 모두 포함
- KOPIS 429 시뮬레이션: `KOPIS_MAX_PAGES=10000` 설정 후 sync 로그에서 "rate limit hit, stopping pagination early" 확인
