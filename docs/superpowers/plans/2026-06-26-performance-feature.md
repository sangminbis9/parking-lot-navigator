# 공연 기능 (Performance Feature) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** KOPIS 공연 데이터(source=kopis)와 음악·공연 카테고리 축제(primaryCategory=music_performance)를 "공연" 기능으로 묶어, 달력 탭 공연 섹션과 지도 공연 레이어 두 곳에 노출한다.

**Architecture:** 기존 D1 discovery_items 파이프라인을 그대로 쓴다. KOPIS 수집 페이지를 100으로 올리고 429 응답 시 조기 종료(빈 배열 반환 → 루프 break)로 한도 초과를 안전하게 처리한다. 새 `/api/performances` 엔드포인트가 D1에서 source='kopis' 이벤트와 primary_category='music_performance' 축제를 각각 쿼리해 하나의 응답으로 반환한다. iOS는 `PerformanceItem` union 타입으로 두 종류를 통합 표시하며, CalendarTabView에 공연 섹션, MapHomeView에 공연 레이어 토글을 추가한다.

**Tech Stack:** Cloudflare Worker (Hono), D1, shared-types TypeScript, SwiftUI iOS 16+, XcodeGen

## Global Constraints

- iOS 최소 지원 버전 16+, SwiftUI
- Worker: Hono + D1, TypeScript strict
- 새 D1 테이블 추가 없음 — `discovery_items` 재활용
- KOPIS API 일일 한도 10,000회; 변경 후 예상 ~2,670회/일 (26.7%)
- 429 발생 시 그 시점까지 수집한 데이터를 유지하고 조기 종료 (빈 배열 → 루프 break)
- D1 stale 임계값 45일 → 429 발생해도 이전 데이터 유효
- 공연 달력 섹션은 즐겨찾기 축제 어젠다 아래 별도 섹션으로 배치 (중복 노출 허용)
- 지도 공연 핀: 기존 festival/event 핀 렌더링 재활용, 색상은 `#E63946` (musicPerformance tint)
- `MapItem` / `MapItemType` shared-types 수정 없음 — 공연 지도 레이어는 `/api/performances`에서 직접 로드
- 타입체크: `pnpm -C worker-backend typecheck`
- iOS 빌드: WSL 환경에서 xcodebuild 불가 → Codemagic 또는 Xcode에서 검증

---

## 파일 구조

```
wrangler.toml                                         # KOPIS 설정 변경
backend/src/features/discover/events/
  KopisEventProvider.ts                               # 429 처리 추가
shared-types/src/discover.ts                          # DiscoverPerformancesResponse 추가
worker-backend/src/
  discoveryCache.ts                                   # queryPerformancesFromCache() 추가
  index.ts                                            # /api/performances 라우트 추가
ios-app/Core/
  Networking/APIClient.swift                          # nearbyPerformances() 추가
  Models/DiscoverItem.swift                           # PerformanceItem enum + response struct 추가
ios-app/Features/Calendar/
  PerformanceViewModel.swift                          # 신규: 공연 ViewModel
  CalendarTabView.swift                               # performanceSection 추가
ios-app/Features/Map/
  MapHomeViewModel.swift                              # 공연 레이어 상태 + 로딩 추가
  MapHomeView.swift                                   # discoverSources + 레이어 토글 추가
ios-app/Tests/ParkingLotNavigatorTests.swift          # PerformanceItem 단위 테스트 추가
```

---

## Task 1: KOPIS 수집 증대 + 429 처리

**Files:**
- Modify: `wrangler.toml`
- Modify: `backend/src/features/discover/events/KopisEventProvider.ts`

**Interfaces:**
- Produces: `KopisEventProvider.fetchPage()` — HTTP 429 응답 시 빈 배열 반환 (기존 루프의 `pageRows.length < EVENT_PAGE_SIZE` break 조건을 자연스럽게 트리거)

- [ ] **Step 1: wrangler.toml 설정 변경**

`worker-backend/wrangler.toml` 의 `[vars]` 섹션에서 다음 두 값을 변경한다:

```toml
KOPIS_MAX_PAGES = "100"
KOPIS_DETAIL_MAX_ITEMS = "50"
```

- [ ] **Step 2: KopisEventProvider.fetchPage()에 429 처리 추가**

`backend/src/features/discover/events/KopisEventProvider.ts`의 `fetchPage` 메서드를 아래와 같이 수정한다.
기존 `if (!response.ok) throw new Error(...)` 앞에 429 체크를 삽입한다:

```typescript
  private async fetchPage(
    page: number,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>[]> {
    const now = new Date();
    const to = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    const url = new URL("/openApi/restful/pblprfr", this.baseUrl);
    url.searchParams.set("service", this.serviceKey.trim());
    url.searchParams.set("stdate", formatCompactDate(now));
    url.searchParams.set("eddate", formatCompactDate(to));
    url.searchParams.set("cpage", String(page));
    url.searchParams.set("rows", String(EVENT_PAGE_SIZE));
    url.searchParams.set("shcate", "");

    const response = await fetchWithTimeout(url, {
      signal,
      headers: { Accept: "application/xml,text/xml,*/*" },
    });
    if (response.status === 429) {
      console.warn(`KOPIS rate limit hit at page ${page}, stopping pagination early`);
      return [];
    }
    if (!response.ok) throw new Error(`KOPIS API failed: ${response.status}`);
    return parseXmlItems(await response.text(), "db");
  }
```

- [ ] **Step 3: 타입체크 실행**

```bash
pnpm -C worker-backend typecheck
```

Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add worker-backend/wrangler.toml backend/src/features/discover/events/KopisEventProvider.ts
git commit -m "Increase KOPIS max pages to 100 and add 429 rate-limit guard"
```

---

## Task 2: shared-types + Worker `/api/performances` 엔드포인트

**Files:**
- Modify: `shared-types/src/discover.ts`
- Modify: `worker-backend/src/discoveryCache.ts`
- Modify: `worker-backend/src/index.ts`

**Interfaces:**
- Consumes: Task 1 — 변경 없음, 기존 `queryDiscoveryRows`, `mapEventRow`, `mapFestivalRow`, `dedupeFestivals` (모두 `discoveryCache.ts` 내부 함수)
- Produces:
  - `DiscoverPerformancesResponse` (shared-types export)
  - `queryPerformancesFromCache(db, lat, lng, options): Promise<{ festivals: Festival[]; events: FreeEvent[] }>`
  - `GET /api/performances?lat=&lng=&radiusMeters=&upcomingWithinDays=` → `DiscoverPerformancesResponse`

- [ ] **Step 1: shared-types에 DiscoverPerformancesResponse 추가**

`shared-types/src/discover.ts` 파일 끝에 추가한다:

```typescript
export interface DiscoverPerformancesResponse {
  festivals: Festival[];
  events: FreeEvent[];
  generatedAt: string;
}
```

- [ ] **Step 2: discoveryCache.ts에 queryPerformancesFromCache 추가**

`worker-backend/src/discoveryCache.ts`의 `queryEventsFromCache` 함수(line 205) 바로 아래에 추가한다:

```typescript
export async function queryPerformancesFromCache(
  db: D1Database,
  lat: number,
  lng: number,
  options: DiscoveryQueryOptions,
): Promise<{ festivals: Festival[]; events: FreeEvent[] }> {
  const [eventRows, festivalRows] = await Promise.all([
    queryDiscoveryRows(db, "event", lat, lng, options),
    queryDiscoveryRows(db, "festival", lat, lng, options),
  ]);
  const events = eventRows
    .filter((row) => row.source === "kopis")
    .map((row) => mapEventRow(row, lat, lng));
  const festivals = dedupeFestivals(
    festivalRows
      .filter((row) => row.primary_category === "music_performance")
      .map((row) => mapFestivalRow(row, lat, lng)),
  );
  return { festivals, events };
}
```

- [ ] **Step 3: index.ts에 import 추가**

`worker-backend/src/index.ts` 상단의 `discoveryCache` import 블록에 `queryPerformancesFromCache`를 추가한다:

```typescript
import {
  currentDiscoveryChunkIndex,
  DISCOVERY_PROVIDER_CHUNK_COUNT,
  queryDiscoveryClusters,
  queryFestivalsFromCache,
  queryPerformancesFromCache,   // 추가
  reapStaleSyncRuns,
  syncDiscoveryCache,
  syncDiscoveryChunk,
} from "./discoveryCache.js";
```

그리고 `DiscoverPerformancesResponse`를 shared-types import에 추가한다:

```typescript
import type { MapItem, DiscoverPerformancesResponse } from "@parking/shared-types";
```

- [ ] **Step 4: /api/performances 라우트 추가**

`worker-backend/src/index.ts`에서 기존 `app.get("/api/festivals", ...)` 라우트 바로 아래에 추가한다:

```typescript
app.get("/api/performances", async (c) => {
  if (!c.env.DB) return c.json({ error: "DB not configured" }, 503);
  const query = discoverQuerySchema.safeParse(queryObject(c.req.url));
  if (!query.success) return c.json({ error: "Invalid query" }, 400);
  const { lat, lng, radiusMeters, upcomingWithinDays } = query.data;
  const options: DiscoveryQueryOptions = {
    radiusMeters: radiusMeters ?? 50_000,
    upcomingWithinDays: upcomingWithinDays ?? 365,
  };
  const { festivals, events } = await queryPerformancesFromCache(
    c.env.DB,
    lat,
    lng,
    options,
  );
  return c.json({
    festivals,
    events,
    generatedAt: new Date().toISOString(),
  } satisfies DiscoverPerformancesResponse);
});
```

**참고:** `discoverQuerySchema`와 `queryObject`는 이미 `index.ts`에 정의되어 있으며 재사용한다. `DiscoveryQueryOptions`는 `discoveryCache.ts`에서 이미 import되어 있다.

- [ ] **Step 5: 타입체크 실행**

```bash
pnpm -C worker-backend typecheck
```

Expected: 에러 없음.

- [ ] **Step 6: 커밋**

```bash
git add shared-types/src/discover.ts worker-backend/src/discoveryCache.ts worker-backend/src/index.ts
git commit -m "Add /api/performances endpoint with KOPIS + music_performance festival query"
```

---

## Task 3: iOS 데이터 레이어 (APIClient + PerformanceItem + 단위 테스트)

**Files:**
- Modify: `ios-app/Core/Models/DiscoverItem.swift`
- Modify: `ios-app/Core/Networking/APIClient.swift`
- Modify: `ios-app/Tests/ParkingLotNavigatorTests.swift`

**Interfaces:**
- Produces:
  - `struct DiscoverPerformancesResponse: Decodable` (festivals, events, generatedAt)
  - `enum PerformanceItem: Identifiable` — `.festival(Festival)` | `.event(FreeEvent)`
  - `PerformanceItem.id: String`
  - `PerformanceItem.presentation: DiscoverPresentation`
  - `PerformanceItem.startDate: String`
  - `PerformanceItem.endDate: String`
  - `PerformanceItem.lat: Double`
  - `PerformanceItem.lng: Double`
  - `PerformanceItem.discoverDestination: Destination`
  - `APIClientProtocol.nearbyPerformances(lat:lng:radiusMeters:upcomingWithinDays:) async throws -> (festivals: [Festival], events: [FreeEvent])`

- [ ] **Step 1: DiscoverItem.swift에 DiscoverPerformancesResponse struct 추가**

`ios-app/Core/Models/DiscoverItem.swift` 파일 끝(`DiscoverEventsResponse` 바로 아래)에 추가한다:

```swift
struct DiscoverPerformancesResponse: Decodable {
    let festivals: [Festival]
    let events: [FreeEvent]
    let generatedAt: String
}
```

- [ ] **Step 2: DiscoverItem.swift에 PerformanceItem enum 추가**

`DiscoverPerformancesResponse` struct 아래에 추가한다:

```swift
enum PerformanceItem: Identifiable {
    case festival(Festival)
    case event(FreeEvent)

    var id: String {
        switch self {
        case .festival(let f): return "perf-festival-\(f.id)"
        case .event(let e): return "perf-event-\(e.id)"
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

    var endDate: String {
        switch self {
        case .festival(let f): return f.endDate
        case .event(let e): return e.endDate
        }
    }

    var lat: Double {
        switch self {
        case .festival(let f): return f.lat
        case .event(let e): return e.lat
        }
    }

    var lng: Double {
        switch self {
        case .festival(let f): return f.lng
        case .event(let e): return e.lng
        }
    }

    var discoverDestination: Destination {
        switch self {
        case .festival(let f): return f.discoverDestination
        case .event(let e): return e.discoverDestination
        }
    }
}
```

- [ ] **Step 3: APIClientProtocol에 nearbyPerformances 추가**

`ios-app/Core/Networking/APIClient.swift`의 `protocol APIClientProtocol` 블록에 추가한다:

```swift
protocol APIClientProtocol {
    func searchDestination(query: String) async throws -> [Destination]
    func nearbyParking(lat: Double, lng: Double, radiusMeters: Int) async throws -> [ParkingLot]
    func realtimeParking(lat: Double, lng: Double, radiusMeters: Int) async throws -> [ParkingLot]
    func nearbyFestivals(lat: Double, lng: Double, radiusMeters: Int, upcomingWithinDays: Int) async throws -> [Festival]
    func nearbyEvents(lat: Double, lng: Double, radiusMeters: Int) async throws -> [FreeEvent]
    func nearbyPerformances(lat: Double, lng: Double, radiusMeters: Int, upcomingWithinDays: Int) async throws -> (festivals: [Festival], events: [FreeEvent])  // 추가
    func recordSearchHistory(destination: Destination, queryText: String, deviceId: String) async throws
    func providerHealth() async throws -> [ProviderHealth]
    func discoveryProviderHealth() async throws -> [ProviderHealth]
    func agentActivity(since: String?, limit: Int) async throws -> [AgentActivityEvent]
}
```

- [ ] **Step 4: APIClient 구현체에 nearbyPerformances 추가**

`ios-app/Core/Networking/APIClient.swift`의 `final class APIClient`에서 `nearbyEvents` 메서드 바로 아래에 추가한다:

```swift
func nearbyPerformances(lat: Double, lng: Double, radiusMeters: Int, upcomingWithinDays: Int) async throws -> (festivals: [Festival], events: [FreeEvent]) {
    var components = URLComponents(url: endpoint("api/performances"), resolvingAgainstBaseURL: false)!
    components.queryItems = [
        URLQueryItem(name: "lat", value: String(lat)),
        URLQueryItem(name: "lng", value: String(lng)),
        URLQueryItem(name: "radiusMeters", value: String(radiusMeters)),
        URLQueryItem(name: "upcomingWithinDays", value: String(upcomingWithinDays))
    ]
    let response: DiscoverPerformancesResponse = try await get(components.url!)
    return (festivals: response.festivals, events: response.events)
}
```

- [ ] **Step 5: MockAPIClient에 nearbyPerformances 추가**

`ios-app/Core/Networking/APIClient.swift`의 `final class MockAPIClient`에서 `nearbyEvents` 메서드 바로 아래에 추가한다:

```swift
func nearbyPerformances(lat: Double, lng: Double, radiusMeters: Int, upcomingWithinDays: Int) async throws -> (festivals: [Festival], events: [FreeEvent]) {
    return (
        festivals: [
            Festival(id: "mock-perf-festival", title: "2026 서울재즈페스티벌", subtitle: "음악 공연",
                     description: nil, startDate: "2026-05-24", endDate: "2026-05-26",
                     status: .upcoming, venueName: "올림픽공원 88잔디마당",
                     address: "서울특별시 송파구 올림픽로 424",
                     lat: lat + 0.002, lng: lng + 0.002, distanceMeters: 280,
                     source: "mock", sourceUrl: nil, imageUrl: nil, imageUrls: [], tags: [],
                     primaryCategory: .musicPerformance, categoryTags: ["공연"])
        ],
        events: []
    )
}
```

- [ ] **Step 6: 단위 테스트 작성**

`ios-app/Tests/ParkingLotNavigatorTests.swift`에 테스트를 추가한다. 기존 `testFestivalFilterMatchesCustomDateRange` 테스트 바로 아래, 마지막 `}` 앞에 추가한다:

```swift
    func testPerformanceItemFestivalId() {
        let festival = Festival.mock(status: .ongoing)
        let item = PerformanceItem.festival(festival)
        XCTAssertEqual(item.id, "perf-festival-\(festival.id)")
    }

    func testPerformanceItemEventId() {
        let event = FreeEvent.mockPerformance()
        let item = PerformanceItem.event(event)
        XCTAssertEqual(item.id, "perf-event-\(event.id)")
    }

    func testPerformanceItemFestivalDates() {
        let festival = Festival.mock(status: .upcoming, startDate: "2026-07-01", endDate: "2026-07-31")
        let item = PerformanceItem.festival(festival)
        XCTAssertEqual(item.startDate, "2026-07-01")
        XCTAssertEqual(item.endDate, "2026-07-31")
    }

    func testPerformanceItemEventDates() {
        let event = FreeEvent.mockPerformance(startDate: "2026-08-01", endDate: "2026-08-03")
        let item = PerformanceItem.event(event)
        XCTAssertEqual(item.startDate, "2026-08-01")
        XCTAssertEqual(item.endDate, "2026-08-03")
    }
```

그리고 파일 맨 아래(기존 `private extension Festival` 블록 뒤)에 `FreeEvent` mock helper를 추가한다:

```swift
private extension FreeEvent {
    static func mockPerformance(
        startDate: String = "2026-07-01",
        endDate: String = "2026-07-02"
    ) -> FreeEvent {
        FreeEvent(
            id: UUID().uuidString,
            title: "테스트 공연",
            eventType: "performance",
            category: nil,
            sourceId: nil,
            startDate: startDate,
            endDate: endDate,
            status: .approved,
            storeName: "공연장",
            venueName: "공연장",
            address: "서울",
            lat: 37.5,
            lng: 126.9,
            distanceMeters: 100,
            source: "kopis",
            sourceUrl: nil,
            imageUrl: nil,
            benefit: nil,
            shortDescription: nil,
            region: nil,
            updatedAt: nil,
            confidenceScore: nil,
            needsReview: nil,
            isSponsored: false,
            sponsorTier: nil,
            paidUntil: nil,
            priorityScore: 0
        )
    }
}
```

- [ ] **Step 7: 커밋**

```bash
git add ios-app/Core/Models/DiscoverItem.swift ios-app/Core/Networking/APIClient.swift ios-app/Tests/ParkingLotNavigatorTests.swift
git commit -m "Add PerformanceItem, DiscoverPerformancesResponse, and nearbyPerformances API call"
```

---

## Task 4: PerformanceViewModel + CalendarTabView 공연 섹션

**Files:**
- Create: `ios-app/Features/Calendar/PerformanceViewModel.swift`
- Modify: `ios-app/Features/Calendar/CalendarTabView.swift`

**Interfaces:**
- Consumes (from Task 3):
  - `PerformanceItem` enum with `.festival(Festival)`, `.event(FreeEvent)`, `.id`, `.startDate`, `.endDate`, `.presentation`, `.discoverDestination`
  - `APIClientProtocol.nearbyPerformances(lat:lng:radiusMeters:upcomingWithinDays:)`
- Produces: `PerformanceViewModel` — `@MainActor ObservableObject`, `@Published performances: [PerformanceItem]`, `func load(coordinate:) async`

- [ ] **Step 1: PerformanceViewModel 파일 생성**

`ios-app/Features/Calendar/PerformanceViewModel.swift`를 새로 만든다:

```swift
import Foundation

@MainActor
final class PerformanceViewModel: ObservableObject {
    @Published var performances: [PerformanceItem] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let apiClient: APIClientProtocol
    private let radiusMeters = 50_000
    private let upcomingWithinDays = 365

    init(apiClient: APIClientProtocol) {
        self.apiClient = apiClient
    }

    func load(coordinate: (lat: Double, lng: Double)?) async {
        let lat = coordinate?.lat ?? 37.5665
        let lng = coordinate?.lng ?? 126.9780
        isLoading = true
        errorMessage = nil
        do {
            let result = try await apiClient.nearbyPerformances(
                lat: lat,
                lng: lng,
                radiusMeters: radiusMeters,
                upcomingWithinDays: upcomingWithinDays
            )
            let festivalItems = result.festivals.map { PerformanceItem.festival($0) }
            let eventItems = result.events.map { PerformanceItem.event($0) }
            performances = (festivalItems + eventItems).sorted { $0.startDate < $1.startDate }
        } catch {
            errorMessage = "공연 정보를 불러오지 못했습니다."
        }
        isLoading = false
    }

    func performancesForDay(_ day: Date, calendar: Calendar, formatter: DateFormatter) -> [PerformanceItem] {
        let dayKey = formatter.string(from: day)
        return performances.filter { item in
            item.startDate <= dayKey && item.endDate >= dayKey
        }
    }
}
```

- [ ] **Step 2: XcodeGen 실행으로 신규 파일을 Xcode 프로젝트에 등록**

WSL 환경 외에서 (Mac 또는 Codemagic 빌드 시 자동):

```bash
cd ios-app && xcodegen generate
```

WSL에서는 이 단계를 건너뛰고, Codemagic 빌드 시 자동 등록된다.

- [ ] **Step 3: CalendarTabView에 @StateObject PerformanceViewModel 추가**

`ios-app/Features/Calendar/CalendarTabView.swift`의 `struct CalendarTabView` 내부에 다음을 추가한다.

기존 `@StateObject private var reminderService` 바로 아래에:
```swift
@StateObject private var performanceViewModel: PerformanceViewModel
```

그리고 기존 `init(apiClient:)` 내부에서 `_viewModel = StateObject(...)` 바로 아래에:
```swift
_performanceViewModel = StateObject(wrappedValue: PerformanceViewModel(apiClient: apiClient))
```

- [ ] **Step 4: body에 performanceSection 추가**

기존 `agendaSection(items: agendaItems)` 호출 바로 아래에 `performanceSection` 뷰를 추가한다:

```swift
var body: some View {
    let byDay = favoriteFestivalsByDay
    let agendaItems = agendaFestivals(from: byDay)
    VStack(spacing: 0) {
        header
        CalendarMonthView(
            monthAnchor: monthAnchor,
            festivalsByDay: byDay,
            selectedDay: selectedDay,
            savedDayKeys: savedDayKeys,
            onSelectDay: handleSelectDay,
            onSwipeMonth: { shiftMonth(by: $0) }
        )
        .padding(.top, 12)
        legend
            .padding(.vertical, 10)
        Divider()
            .overlay(FestivalDesign.creamDeep.opacity(0.4))
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                agendaSection(items: agendaItems)
                performanceSection
            }
        }
    }
    // ... (기존 modifier 유지)
}
```

**주의:** 기존 `agendaSection`은 내부에 `ScrollView`를 포함하고 있어 중첩이 생긴다. 다음 Step에서 `agendaSection`을 `ScrollView` 없이 내용만 반환하도록 수정한다.

- [ ] **Step 5: agendaSection을 ScrollView 비포함 뷰로 분리**

기존 `agendaSection(items:)` 는 내부에 `ScrollView`를 포함한다. 공연 섹션과 함께 하나의 `ScrollView`에 넣기 위해 내용 부분을 `agendaContent(items:)`로 분리한다:

```swift
// 기존 agendaSection(items:)를 다음으로 교체:
private func agendaSection(items: [Festival]) -> some View {
    agendaContent(items: items)
}

private func agendaContent(items: [Festival]) -> some View {
    VStack(alignment: .leading, spacing: 12) {
        Text(agendaTitle(count: items.count))
            .font(.festival(size: 14, weight: .bold))
            .foregroundStyle(FestivalDesign.navy)
            .padding(.horizontal, 16)

        if case .failed(let message) = viewModel.state {
            Text(message)
                .font(.festival(size: 12))
                .foregroundStyle(FestivalDesign.coral)
                .padding(.horizontal, 16)
        } else if items.isEmpty {
            emptyAgenda
        } else {
            ForEach(items) { festival in
                AgendaRow(
                    festival: festival,
                    isSaved: favoritesStore.contains(id: festival.id),
                    isReminderOn: reminderService.isScheduled(id: festival.id),
                    onSelect: { handleSelectFestival(festival) },
                    onToggleSave: { toggleSave(festival) },
                    onToggleReminder: { toggleReminderForFestival(festival) }
                )
                .padding(.horizontal, 16)
            }
        }
    }
    .padding(.vertical, 14)
}
```

그리고 `body`의 `ScrollView`를 다음과 같이 구성한다:

```swift
ScrollView {
    VStack(alignment: .leading, spacing: 0) {
        agendaContent(items: agendaItems)
        performanceSection
    }
}
```

- [ ] **Step 6: performanceSection 구현**

`CalendarTabView`에 `performanceSection` computed property를 추가한다:

```swift
private var performanceSection: some View {
    let dayFormatter = CalendarViewModel.dayFormatter
    let items: [PerformanceItem] = {
        guard let day = selectedDay else { return [] }
        return performanceViewModel.performancesForDay(day, calendar: calendar, formatter: dayFormatter)
    }()

    return VStack(alignment: .leading, spacing: 12) {
        Divider()
            .overlay(FestivalDesign.creamDeep.opacity(0.4))
            .padding(.horizontal, 16)

        HStack(spacing: 6) {
            Image(systemName: "music.note")
                .font(.festival(size: 12, weight: .bold))
                .foregroundStyle(FestivalPrimaryCategory.musicPerformance.tint)
            Text("근처 공연 · \(items.count)개")
                .font(.festival(size: 14, weight: .bold))
                .foregroundStyle(FestivalDesign.navy)
            Spacer()
            if performanceViewModel.isLoading {
                ProgressView()
                    .controlSize(.small)
            }
        }
        .padding(.horizontal, 16)

        if items.isEmpty && !performanceViewModel.isLoading {
            Text("선택한 날짜에 근처 공연이 없습니다")
                .font(.festival(size: 12))
                .foregroundStyle(FestivalDesign.secondaryText)
                .padding(.horizontal, 16)
        } else {
            ForEach(items) { item in
                PerformanceRow(item: item) {
                    router.showResults(for: item.discoverDestination, presentation: item.presentation)
                }
                .padding(.horizontal, 16)
            }
        }
    }
    .padding(.bottom, 14)
}
```

- [ ] **Step 7: PerformanceRow 추가**

`CalendarTabView.swift` 파일 맨 아래(기존 `AgendaRow` private struct 아래)에 추가한다:

```swift
private struct PerformanceRow: View {
    let item: PerformanceItem
    let onSelect: () -> Void

    var body: some View {
        let p = item.presentation
        HStack(alignment: .top, spacing: 12) {
            RoundedRectangle(cornerRadius: 6)
                .fill(FestivalPrimaryCategory.musicPerformance.tint)
                .frame(width: 4)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(p.status.displayText)
                        .font(.festival(size: 10, weight: .bold))
                        .foregroundStyle(FestivalPrimaryCategory.musicPerformance.tint)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(FestivalPrimaryCategory.musicPerformance.tint.opacity(0.12))
                        .clipShape(FestivalDesign.chipShape)
                    Text(item.startDate == item.endDate ? item.startDate : "\(item.startDate) ~ \(item.endDate)")
                        .font(.festival(size: 11, weight: .medium))
                        .foregroundStyle(FestivalDesign.secondaryText)
                }
                Text(p.title)
                    .font(.festival(size: 15, weight: .bold))
                    .foregroundStyle(FestivalDesign.navy)
                    .multilineTextAlignment(.leading)
                if let venue = p.venueName, !venue.isEmpty {
                    Text(venue)
                        .font(.festival(size: 12))
                        .foregroundStyle(FestivalDesign.secondaryText)
                }
                Text(p.address)
                    .font(.festival(size: 11))
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .festivalCard()
        .contentShape(Rectangle())
        .onTapGesture(perform: onSelect)
    }
}
```

- [ ] **Step 8: .task modifier에 공연 로딩 추가**

기존 `.task` modifier에서 `await reload()` 이후에 공연 로딩을 추가한다:

```swift
.task {
    locationProvider.request()
    await reload()
    let coord = locationProvider.coordinate.map { (lat: $0.latitude, lng: $0.longitude) }
    await performanceViewModel.load(coordinate: coord)
    await reminderService.refreshScheduled()
}
```

- [ ] **Step 9: 커밋**

```bash
git add ios-app/Features/Calendar/PerformanceViewModel.swift ios-app/Features/Calendar/CalendarTabView.swift
git commit -m "Add performance section to CalendarTabView with PerformanceViewModel"
```

---

## Task 5: 지도 공연 레이어

**Files:**
- Modify: `ios-app/Features/Map/MapHomeViewModel.swift`
- Modify: `ios-app/Features/Map/MapHomeView.swift`

**Interfaces:**
- Consumes (from Task 3):
  - `PerformanceItem` enum with `.festival`, `.event`, `.lat`, `.lng`, `.discoverDestination`, `.presentation`
  - `APIClientProtocol.nearbyPerformances(lat:lng:radiusMeters:upcomingWithinDays:)`
- Consumes (from MapHomeView existing):
  - `enum DiscoverPinSource { case festival(Festival); case event(FreeEvent) }` — 새 case 없이 기존 재활용
  - `private var discoverSources: [DiscoverPinSource]`
  - `private func layerToggle(title:systemImage:tint:isOn:action:) -> some View`

- [ ] **Step 1: MapHomeViewModel에 공연 레이어 상태 추가**

`ios-app/Features/Map/MapHomeViewModel.swift`의 `@Published` 프로퍼티 블록에서 `showsLocalEventLayer` 아래에 추가한다:

```swift
@Published var showsPerformanceLayer = false
@Published var performances: [PerformanceItem] = []
```

- [ ] **Step 2: setPerformanceLayerVisible 추가**

`setLocalEventLayerVisible` 메서드 바로 아래에 추가한다:

```swift
func setPerformanceLayerVisible(_ isVisible: Bool, viewport: MapViewport) async {
    showsPerformanceLayer = isVisible
    if !isVisible {
        performances = []
        return
    }
    await loadDiscoverLayers(viewport: viewport)
}
```

- [ ] **Step 3: loadDiscoverLayers에 공연 레이어 로딩 추가**

기존 `loadDiscoverLayers(viewport:filter:showsError:)` 메서드에서 `if showsLocalEventLayer` 블록 바로 아래에 추가한다:

```swift
if showsPerformanceLayer {
    attemptedLoads += 1
    switch await loadPerformanceLayer(viewport: viewport) {
    case .success(let items):
        performances = items
    case .failure:
        failedLoads += 1
    }
}
```

- [ ] **Step 4: loadPerformanceLayer private 메서드 추가**

`loadEventLayer` private 메서드 바로 아래에 추가한다:

```swift
private func loadPerformanceLayer(viewport: MapViewport) async -> Result<[PerformanceItem], Error> {
    do {
        let result = try await apiClient.nearbyPerformances(
            lat: viewport.center.latitude,
            lng: viewport.center.longitude,
            radiusMeters: viewportDiscoverRadiusMeters(for: viewport),
            upcomingWithinDays: 365
        )
        let items = result.festivals.map { PerformanceItem.festival($0) }
            + result.events.map { PerformanceItem.event($0) }
        return .success(items)
    } catch {
        return .failure(error)
    }
}
```

- [ ] **Step 5: MapHomeView discoverSources에 공연 핀 추가**

`ios-app/Features/Map/MapHomeView.swift`의 `private var discoverSources: [DiscoverPinSource]` 에서 기존 `showsLocalEventLayer` 블록 아래에 추가한다:

```swift
private var discoverSources: [DiscoverPinSource] {
    var sources: [DiscoverPinSource] = []
    if viewModel.showsFestivalLayer {
        sources.append(contentsOf: viewModel.festivals.map { .festival($0) })
    }
    if viewModel.showsLocalEventLayer {
        sources.append(contentsOf: viewModel.events.map { .event($0) })
    }
    if viewModel.showsPerformanceLayer {
        for item in viewModel.performances {
            switch item {
            case .festival(let f): sources.append(.festival(f))
            case .event(let e): sources.append(.event(e))
            }
        }
    }
    return sources
}
```

- [ ] **Step 6: discoverLayerToggles에 공연 토글 버튼 추가**

`ios-app/Features/Map/MapHomeView.swift`의 `discoverLayerToggles`에서 기존 이벤트 `layerToggle` 바로 아래에 추가한다:

```swift
layerToggle(
    title: "공연",
    systemImage: "music.note",
    tint: FestivalPrimaryCategory.musicPerformance.tint,
    isOn: viewModel.showsPerformanceLayer
) {
    Task { await viewModel.setPerformanceLayerVisible(!viewModel.showsPerformanceLayer, viewport: mapViewport) }
}
```

- [ ] **Step 7: 커밋**

```bash
git add ios-app/Features/Map/MapHomeViewModel.swift ios-app/Features/Map/MapHomeView.swift
git commit -m "Add performance map layer toggle to MapHomeView and MapHomeViewModel"
```

---

## 검증 체크리스트

**Worker (각 Task 완료 후):**
```bash
pnpm -C worker-backend typecheck
```

**Worker 배포 후 엔드포인트 확인:**
```bash
curl "https://parking-lot-navigator-api.parkingnav.workers.dev/api/performances?lat=37.5665&lng=126.978&radiusMeters=50000&upcomingWithinDays=365" | head -c 500
```
Expected: `{"festivals":[...],"events":[...],"generatedAt":"..."}` 형태

**KOPIS 429 처리 확인 (로그):**
- Worker 배포 후 sync 로그에서 `KOPIS rate limit hit at page N, stopping pagination early` 메시지 확인 (429 발생 시에만 출력)

**iOS (Task 4, 5 완료 후):**
- Codemagic 또는 Xcode에서 빌드 오류 없음 확인
- CalendarTabView: 날짜 선택 시 "근처 공연" 섹션이 하단에 표시됨
- MapHomeView: 공연 토글 버튼 표시 → 탭 시 공연 핀이 지도에 표시됨

**iOS 빌드 번호:** Task 5 완료 후 `ios-app/project.yml`의 `CURRENT_PROJECT_VERSION`을 178로 올릴 것 (별도 커밋).
