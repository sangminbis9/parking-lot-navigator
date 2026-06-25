# 축제 필터 개편 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 축제 조회 기간을 1년으로 확장하고, 날짜 직접 선택을 지원하며, 지도·캘린더 탭이 동일한 필터를 공유하도록 개편한다.

**Architecture:** `FestivalFilter`에 `FestivalDateRange` enum과 커스텀 날짜 필드를 추가한다. `FestivalFilterModel`을 `AppRootView`에서 단일 `@StateObject`로 생성해 두 탭에 `@EnvironmentObject`로 주입한다. 지도 탭은 필터 버튼과 `onChange` 재로드를 추가해 필터를 활용한다.

**Tech Stack:** SwiftUI, XCTest, UserDefaults(AppGroup), Cloudflare Worker(변경 없음)

## Global Constraints

- iOS 16.0 이상
- `AppGroupID`: `AppConfiguration.current.appGroupID` 사용
- 날짜 포맷 문자열: `"yyyy-MM-dd"`, `Locale(identifier: "en_US_POSIX")`
- UserDefaults scope 키: `"festivalFilter.shared"` (기존 `"festivalFilter.calendar"` 대체)
- Worker 변경 없음 — `/api/festivals`는 `upcomingWithinDays: 0–365` 이미 지원
- 코드 스타일: 주변 코드와 동일하게, 주석 최소화
- 커밋은 한국어 설명 없이 영어로

---

## 파일 변경 지도

| 파일 | 역할 |
|---|---|
| `Core/Storage/FestivalFilterStore.swift` | `FestivalDateRange` 추가, `statuses` → `dateRange` 교체, `matches()` 수정 |
| `Core/Networking/APIClient.swift` | `nearbyFestivals` 시그니처 + URL 파라미터 |
| `Features/Calendar/CalendarViewModel.swift` | `nearbyFestivals` 호출 시 `upcomingWithinDays` 전달 |
| `App/AppRootView.swift` | `FestivalFilterModel` 생성 + EnvironmentObject 주입 |
| `Features/Calendar/CalendarTabView.swift` | `@StateObject` → `@EnvironmentObject`, init 단순화 |
| `Core/Services/FestivalSyncService.swift` | scope `"calendar"` → `"shared"` |
| `Features/Map/MapHomeViewModel.swift` | `loadDiscoverLayers`·`setFestivalLayerVisible` 등에 `filter` 파라미터 추가 |
| `Features/Map/MapHomeView.swift` | 필터 버튼, `.onChange` 재로드, sheet |
| `Features/Calendar/FilterSheetView.swift` | 기간 섹션(프리셋 + DatePicker) 추가, `statusSection` 제거 |
| `Tests/ParkingLotNavigatorTests.swift` | `FestivalDateRange`·`FestivalFilter.matches()` 단위 테스트 |

---

## Task 1: FestivalDateRange + FestivalFilter 모델 교체

**Files:**
- Modify: `ios-app/Core/Storage/FestivalFilterStore.swift`
- Modify: `ios-app/Tests/ParkingLotNavigatorTests.swift`

**Interfaces:**
- Produces:
  - `enum FestivalDateRange: String, Codable, CaseIterable` (7개 케이스)
  - `FestivalDateRange.upcomingWithinDays: Int`
  - `FestivalDateRange.displayLabel: String`
  - `FestivalFilter.dateRange: FestivalDateRange`
  - `FestivalFilter.customFromDate: String?`
  - `FestivalFilter.customToDate: String?`
  - `FestivalFilter.matches(_ festival: Festival) -> Bool` (기존 시그니처 유지)
  - `FestivalFilter.default` 기본값 `.ongoingOnly`

- [ ] **Step 1: 테스트 작성 (실패 확인용)**

`ParkingLotNavigatorTests.swift` 클래스 끝 `}` 앞에 추가:

```swift
func testFestivalDateRangeUpcomingWithinDays() {
    XCTAssertEqual(FestivalDateRange.ongoingOnly.upcomingWithinDays, 365)
    XCTAssertEqual(FestivalDateRange.oneMonth.upcomingWithinDays, 30)
    XCTAssertEqual(FestivalDateRange.twoMonths.upcomingWithinDays, 60)
    XCTAssertEqual(FestivalDateRange.threeMonths.upcomingWithinDays, 90)
    XCTAssertEqual(FestivalDateRange.sixMonths.upcomingWithinDays, 180)
    XCTAssertEqual(FestivalDateRange.oneYear.upcomingWithinDays, 365)
    XCTAssertEqual(FestivalDateRange.custom.upcomingWithinDays, 365)
}

func testFestivalFilterMatchesOngoingOnly() {
    let filter = FestivalFilter(
        regions: [], radiusKm: nil, primaryCategories: [],
        dateRange: .ongoingOnly, customFromDate: nil, customToDate: nil
    )
    let ongoing = Festival.mock(status: .ongoing)
    let upcoming = Festival.mock(status: .upcoming)
    XCTAssertTrue(filter.matches(ongoing))
    XCTAssertFalse(filter.matches(upcoming))
}

func testFestivalFilterMatchesCustomDateRange() {
    let filter = FestivalFilter(
        regions: [], radiusKm: nil, primaryCategories: [],
        dateRange: .custom, customFromDate: "2026-07-10", customToDate: "2026-07-20"
    )
    // 겹치는 축제: 7/5~7/12
    let overlaps = Festival.mock(status: .upcoming, startDate: "2026-07-05", endDate: "2026-07-12")
    // 범위 밖: 7/21~7/25
    let after = Festival.mock(status: .upcoming, startDate: "2026-07-21", endDate: "2026-07-25")
    // 범위 밖: 7/1~7/9
    let before = Festival.mock(status: .upcoming, startDate: "2026-07-01", endDate: "2026-07-09")
    XCTAssertTrue(filter.matches(overlaps))
    XCTAssertFalse(filter.matches(after))
    XCTAssertFalse(filter.matches(before))
}
```

`Festival.mock` 헬퍼를 `ParkingLotNavigatorTests.swift` 파일 맨 아래(클래스 외부)에 추가:

```swift
private extension Festival {
    static func mock(
        status: DiscoverStatus,
        startDate: String = "2026-06-01",
        endDate: String = "2026-06-30"
    ) -> Festival {
        Festival(
            id: UUID().uuidString,
            title: "테스트 축제",
            subtitle: nil,
            description: nil,
            startDate: startDate,
            endDate: endDate,
            status: status,
            venueName: nil,
            address: "서울",
            lat: 37.5,
            lng: 126.9,
            distanceMeters: 100,
            source: "mock",
            sourceUrl: nil,
            imageUrl: nil,
            imageUrls: [],
            tags: [],
            primaryCategory: nil,
            categoryTags: nil
        )
    }
}
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
xcodebuild test -project ios-app/ParkingLotNavigator.xcodeproj \
  -scheme ParkingLotNavigator -destination 'platform=iOS Simulator,name=iPhone 16' \
  -only-testing:ParkingLotNavigatorTests/ParkingLotNavigatorTests/testFestivalDateRangeUpcomingWithinDays 2>&1 | tail -10
```

예상: `error: cannot find type 'FestivalDateRange'` (아직 없음)

- [ ] **Step 3: `FestivalFilterStore.swift` 전체 교체**

`FestivalFilterStore.swift` 파일에서 기존 `struct FestivalFilter` 앞에 `FestivalDateRange` enum을 추가하고, `FestivalFilter` 내부를 아래와 같이 교체한다.

파일 상단 `import Foundation` 직후, 기존 `struct FestivalFilter` 앞에 삽입:

```swift
enum FestivalDateRange: String, Codable, CaseIterable {
    case ongoingOnly
    case oneMonth
    case twoMonths
    case threeMonths
    case sixMonths
    case oneYear
    case custom

    var upcomingWithinDays: Int {
        switch self {
        case .ongoingOnly: return 365
        case .oneMonth: return 30
        case .twoMonths: return 60
        case .threeMonths: return 90
        case .sixMonths: return 180
        case .oneYear, .custom: return 365
        }
    }

    var displayLabel: String {
        switch self {
        case .ongoingOnly: return "진행중"
        case .oneMonth: return "1개월 이내"
        case .twoMonths: return "2개월 이내"
        case .threeMonths: return "3개월 이내"
        case .sixMonths: return "6개월 이내"
        case .oneYear: return "1년 이내"
        case .custom: return "날짜 직접 선택"
        }
    }
}
```

`struct FestivalFilter` 내부를 아래로 교체 (기존 `var statuses: [DiscoverStatus]` 제거, `koreanRegions`·`regionHierarchy`·`cityDisplayName`·`allCityNames`는 그대로 유지):

```swift
struct FestivalFilter: Codable, Hashable {
    var regions: [String]
    var radiusKm: Int?
    var primaryCategories: Set<FestivalPrimaryCategory>
    var dateRange: FestivalDateRange
    var customFromDate: String?
    var customToDate: String?

    static let allRadiusOptions: [Int] = [10, 20, 50]
    static let `default` = FestivalFilter(
        regions: [], radiusKm: 50, primaryCategories: [],
        dateRange: .ongoingOnly, customFromDate: nil, customToDate: nil
    )

    var radiusMeters: Int {
        guard let radiusKm else { return 200_000 }
        return radiusKm * 1_000
    }

    var isEmpty: Bool {
        regions.isEmpty && primaryCategories.isEmpty
            && dateRange == .ongoingOnly
            && radiusKm == FestivalFilter.default.radiusKm
    }

    func matches(_ festival: Festival) -> Bool {
        switch dateRange {
        case .ongoingOnly:
            if festival.status != .ongoing { return false }
        case .custom:
            if let from = customFromDate, let to = customToDate {
                if festival.startDate > to { return false }
                if festival.endDate < from { return false }
            }
        default:
            break
        }
        if !regions.isEmpty {
            let selectedProvinces = regions.filter { Self.koreanRegions.contains($0) }
            let selectedCities = regions.filter { !Self.koreanRegions.contains($0) }
            var matched = false
            if !selectedProvinces.isEmpty {
                let tags = festival.discoverTags.filter { Self.koreanRegions.contains($0) }
                if tags.contains(where: { selectedProvinces.contains($0) }) { matched = true }
            }
            if !matched, !selectedCities.isEmpty {
                if selectedCities.contains(where: { festival.address.contains($0) }) { matched = true }
            }
            if !matched { return false }
        }
        if !primaryCategories.isEmpty {
            guard let category = festival.primaryCategory, primaryCategories.contains(category) else { return false }
        }
        return true
    }

    // (기존 koreanRegions, regionHierarchy, cityDisplayName, allCityNames 유지)

    enum CodingKeys: String, CodingKey {
        case regions, radiusKm, primaryCategories, dateRange, customFromDate, customToDate
    }

    init(regions: [String], radiusKm: Int?, primaryCategories: Set<FestivalPrimaryCategory>,
         dateRange: FestivalDateRange, customFromDate: String?, customToDate: String?) {
        self.regions = regions
        self.radiusKm = radiusKm
        self.primaryCategories = primaryCategories
        self.dateRange = dateRange
        self.customFromDate = customFromDate
        self.customToDate = customToDate
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        regions = try c.decodeIfPresent([String].self, forKey: .regions) ?? []
        radiusKm = try c.decodeIfPresent(Int.self, forKey: .radiusKm)
        primaryCategories = try c.decodeIfPresent(Set<FestivalPrimaryCategory>.self, forKey: .primaryCategories) ?? []
        dateRange = try c.decodeIfPresent(FestivalDateRange.self, forKey: .dateRange) ?? .ongoingOnly
        customFromDate = try c.decodeIfPresent(String.self, forKey: .customFromDate)
        customToDate = try c.decodeIfPresent(String.self, forKey: .customToDate)
    }
}
```

주의: `festival.discoverTags`는 `Festival` 익스텐션에서 오는 계산 프로퍼티다 — 기존 코드에서 사용 중이므로 그대로 유지.

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
xcodebuild test -project ios-app/ParkingLotNavigator.xcodeproj \
  -scheme ParkingLotNavigator -destination 'platform=iOS Simulator,name=iPhone 16' \
  -only-testing:ParkingLotNavigatorTests/ParkingLotNavigatorTests/testFestivalDateRangeUpcomingWithinDays \
  -only-testing:ParkingLotNavigatorTests/ParkingLotNavigatorTests/testFestivalFilterMatchesOngoingOnly \
  -only-testing:ParkingLotNavigatorTests/ParkingLotNavigatorTests/testFestivalFilterMatchesCustomDateRange 2>&1 | tail -10
```

예상: `** TEST SUCCEEDED **`

- [ ] **Step 5: 커밋**

```bash
git add ios-app/Core/Storage/FestivalFilterStore.swift ios-app/Tests/ParkingLotNavigatorTests.swift
git commit -m "Add FestivalDateRange enum and update FestivalFilter model"
```

---

## Task 2: APIClient nearbyFestivals 시그니처 + CalendarViewModel 호출 수정

**Files:**
- Modify: `ios-app/Core/Networking/APIClient.swift`
- Modify: `ios-app/Features/Calendar/CalendarViewModel.swift`

**Interfaces:**
- Consumes: `FestivalDateRange.upcomingWithinDays: Int` (Task 1)
- Produces:
  - `APIClientProtocol.nearbyFestivals(lat:lng:radiusMeters:upcomingWithinDays:)`
  - `MockAPIClient.nearbyFestivals(lat:lng:radiusMeters:upcomingWithinDays:)`

- [ ] **Step 1: `APIClient.swift` 프로토콜 + 구현 수정**

`APIClientProtocol` 내:
```swift
// 변경 전
func nearbyFestivals(lat: Double, lng: Double, radiusMeters: Int) async throws -> [Festival]

// 변경 후
func nearbyFestivals(lat: Double, lng: Double, radiusMeters: Int, upcomingWithinDays: Int) async throws -> [Festival]
```

`APIClient` 구현체 `nearbyFestivals` 메서드:
```swift
func nearbyFestivals(lat: Double, lng: Double, radiusMeters: Int, upcomingWithinDays: Int) async throws -> [Festival] {
    var components = URLComponents(url: endpoint("api/festivals"), resolvingAgainstBaseURL: false)!
    components.queryItems = [
        URLQueryItem(name: "lat", value: String(lat)),
        URLQueryItem(name: "lng", value: String(lng)),
        URLQueryItem(name: "radiusMeters", value: String(radiusMeters)),
        URLQueryItem(name: "upcomingWithinDays", value: String(upcomingWithinDays))
    ]
    let response: DiscoverFestivalsResponse = try await get(components.url!)
    return response.items
}
```

`MockAPIClient` 구현체:
```swift
func nearbyFestivals(lat: Double, lng: Double, radiusMeters: Int, upcomingWithinDays: Int) async throws -> [Festival] {
    [
        Festival(id: "mock-festival", title: "Seoul Light Festival", subtitle: "Night walk festival",
                 description: nil, startDate: "2026-04-15", endDate: "2026-04-22",
                 status: .ongoing, venueName: "Seoul Plaza",
                 address: "110 Sejong-daero, Jung-gu, Seoul",
                 lat: lat + 0.001, lng: lng + 0.001, distanceMeters: 160,
                 source: "mock", sourceUrl: nil, imageUrl: nil, imageUrls: [], tags: ["festival"],
                 primaryCategory: nil, categoryTags: nil)
    ]
}
```

- [ ] **Step 2: `CalendarViewModel.swift` 호출 수정**

`load(coordinate:filter:)` 내 `nearbyFestivals` 호출:
```swift
// 변경 전
let raw = try await apiClient.nearbyFestivals(
    lat: coord.lat,
    lng: coord.lng,
    radiusMeters: filter.radiusMeters
)

// 변경 후
let raw = try await apiClient.nearbyFestivals(
    lat: coord.lat,
    lng: coord.lng,
    radiusMeters: filter.radiusMeters,
    upcomingWithinDays: filter.dateRange.upcomingWithinDays
)
```

- [ ] **Step 3: 기존 테스트 통과 확인**

```bash
xcodebuild test -project ios-app/ParkingLotNavigator.xcodeproj \
  -scheme ParkingLotNavigator -destination 'platform=iOS Simulator,name=iPhone 16' 2>&1 | tail -15
```

예상: `** TEST SUCCEEDED **` (기존 테스트 포함 전부)

- [ ] **Step 4: 커밋**

```bash
git add ios-app/Core/Networking/APIClient.swift ios-app/Features/Calendar/CalendarViewModel.swift
git commit -m "Add upcomingWithinDays param to nearbyFestivals and update CalendarViewModel"
```

---

## Task 3: FestivalFilterModel → AppRootView EnvironmentObject

**Files:**
- Modify: `ios-app/App/AppRootView.swift`
- Modify: `ios-app/Features/Calendar/CalendarTabView.swift`
- Modify: `ios-app/Core/Services/FestivalSyncService.swift`

**Interfaces:**
- Consumes: `FestivalFilterModel(scope:appGroupID:)` (변경 없음)
- Produces: `filterModel`이 `@EnvironmentObject`로 앱 트리에 주입됨

- [ ] **Step 1: `AppRootView.swift` 에 FilterModel 추가**

`AppRootView` 구조체 상단 `@StateObject private var router` 바로 다음 줄에 추가:

```swift
@StateObject private var festivalFilterModel = FestivalFilterModel(
    scope: "shared",
    appGroupID: AppConfiguration.current.appGroupID
)
```

`body` 안 `.environmentObject(tabRouter)` 바로 다음 줄에 추가:

```swift
.environmentObject(festivalFilterModel)
```

- [ ] **Step 2: `CalendarTabView.swift` 수정**

`@StateObject private var filterModel: FestivalFilterModel` →

```swift
@EnvironmentObject private var filterModel: FestivalFilterModel
```

`init(apiClient:)` 내에서 아래 세 줄 제거:

```swift
// 제거할 줄들
let appGroupID = AppConfiguration.current.appGroupID
self.appGroupID = appGroupID
_filterModel = StateObject(wrappedValue: FestivalFilterModel(scope: "calendar", appGroupID: appGroupID))
```

`appGroupID` 프로퍼티와 그 대입 구문이 `init` 외에서도 쓰이는지 확인한다. `CalendarTabView`에서 `appGroupID`를 직접 쓰는 곳이 없으면 `private let appGroupID: String` 선언도 제거한다.

`init` 은 아래처럼 단순해진다:

```swift
init(apiClient: APIClientProtocol) {
    self.apiClient = apiClient
    _viewModel = StateObject(wrappedValue: CalendarViewModel(apiClient: apiClient))
}
```

- [ ] **Step 3: `FestivalSyncService.swift` scope 변경**

파일에서 `scope: "calendar"` 를 찾아 `scope: "shared"` 로 교체한다 (1곳).

- [ ] **Step 4: 빌드 오류 없음 확인**

```bash
xcodebuild build -project ios-app/ParkingLotNavigator.xcodeproj \
  -scheme ParkingLotNavigator -destination 'platform=iOS Simulator,name=iPhone 16' 2>&1 | grep -E "error:|BUILD"
```

예상: `BUILD SUCCEEDED`, `error:` 없음

- [ ] **Step 5: 커밋**

```bash
git add ios-app/App/AppRootView.swift ios-app/Features/Calendar/CalendarTabView.swift ios-app/Core/Services/FestivalSyncService.swift
git commit -m "Hoist FestivalFilterModel to AppRootView as shared EnvironmentObject"
```

---

## Task 4: MapHomeViewModel + MapHomeView 필터 연동

**Files:**
- Modify: `ios-app/Features/Map/MapHomeViewModel.swift`
- Modify: `ios-app/Features/Map/MapHomeView.swift`

**Interfaces:**
- Consumes: `FestivalFilter`, `FestivalFilterModel` (@EnvironmentObject), `APIClientProtocol.nearbyFestivals(lat:lng:radiusMeters:upcomingWithinDays:)` (Task 2)
- Produces: 지도 축제 레이어가 필터 변경 시 자동 재로드됨

- [ ] **Step 1: `MapHomeViewModel.swift` — discoverFestivals에 filter 추가**

`discoverFestivals(viewport:)` 메서드를 아래로 교체:

```swift
private func discoverFestivals(viewport: MapViewport, filter: FestivalFilter) async throws -> [Festival] {
    let raw = try await apiClient.nearbyFestivals(
        lat: viewport.center.latitude,
        lng: viewport.center.longitude,
        radiusMeters: viewportDiscoverRadiusMeters(for: viewport),
        upcomingWithinDays: filter.dateRange.upcomingWithinDays
    )
    return raw.filter { filter.matches($0) }
}
```

- [ ] **Step 2: `MapHomeViewModel.swift` — 공개 메서드에 filter 파라미터 추가**

`loadDiscoverLayers(viewport:showsError:)` 시그니처와 내부 호출 교체:

```swift
func loadDiscoverLayers(viewport: MapViewport, filter: FestivalFilter = .default, showsError: Bool = false) async {
    isLoadingDiscover = true
    errorMessage = nil
    var failedLoads = 0
    var attemptedLoads = 0

    if showsFestivalLayer {
        attemptedLoads += 1
        switch await loadFestivalLayer(viewport: viewport, filter: filter) {
        case .success(let items):
            festivals = items
        case .failure:
            failedLoads += 1
        }
    }
    if showsLocalEventLayer {
        attemptedLoads += 1
        switch await loadEventLayer(viewport: viewport) {
        case .success(let items):
            events = items
        case .failure:
            failedLoads += 1
        }
    }
    if showsError && attemptedLoads > 0 && attemptedLoads == failedLoads {
        errorMessage = "탐색 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
    }
    isLoadingDiscover = false
}
```

`loadFestivalLayer(viewport:)` 를 `loadFestivalLayer(viewport:filter:)` 로 교체:

```swift
private func loadFestivalLayer(viewport: MapViewport, filter: FestivalFilter) async -> Result<[Festival], Error> {
    do {
        return .success(try await discoverFestivals(viewport: viewport, filter: filter))
    } catch {
        return .failure(error)
    }
}
```

`loadInitialDiscoverLayers(viewport:)` 교체:

```swift
func loadInitialDiscoverLayers(viewport: MapViewport, filter: FestivalFilter = .default) async {
    await loadDiscoverLayers(viewport: viewport, filter: filter, showsError: false)
}
```

`setFestivalLayerVisible(_:viewport:)` 교체:

```swift
func setFestivalLayerVisible(_ isVisible: Bool, viewport: MapViewport, filter: FestivalFilter = .default) async {
    showsFestivalLayer = isVisible
    if !isVisible {
        festivals = []
        return
    }
    await loadDiscoverLayers(viewport: viewport, filter: filter)
}
```

`loadDiscoverItems(viewport:)` 내부의 `discoverFestivals(viewport:)` 호출:

```swift
case .festivals:
    festivals = try await discoverFestivals(viewport: viewport, filter: .default)
```

- [ ] **Step 3: `MapHomeView.swift` — EnvironmentObject + 필터 버튼 추가**

뷰 상단 `@StateObject private var viewModel` 바로 위에 추가:

```swift
@EnvironmentObject private var festivalFilterModel: FestivalFilterModel
```

`@State` 변수 블록 안에 추가:

```swift
@State private var presentingFestivalFilter = false
```

`discoverLayerToggles` 의 `ScrollView` 내 `HStack` 마지막 `if viewModel.isLoadingDiscover` 앞에 필터 버튼 추가:

```swift
if viewModel.showsFestivalLayer {
    Button {
        presentingFestivalFilter = true
    } label: {
        Image(systemName: festivalFilterModel.filter.isEmpty
              ? "slider.horizontal.3"
              : "slider.horizontal.3")
            .font(.festival(.caption, weight: .bold))
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(festivalFilterModel.filter.isEmpty
                        ? FestivalDesign.surface.opacity(0.92)
                        : FestivalDesign.coral.opacity(0.15))
            .foregroundStyle(festivalFilterModel.filter.isEmpty
                             ? FestivalDesign.secondaryText
                             : FestivalDesign.coral)
            .clipShape(FestivalDesign.controlShape)
            .overlay(
                FestivalDesign.controlShape
                    .stroke(festivalFilterModel.filter.isEmpty
                            ? FestivalDesign.creamDeep.opacity(0.45)
                            : FestivalDesign.coral.opacity(0.5), lineWidth: 1)
            )
    }
    .buttonStyle(.plain)
    .accessibilityLabel("축제 필터")
}
```

`.onDisappear` 바로 위에 `.sheet` 추가:

```swift
.sheet(isPresented: $presentingFestivalFilter) {
    FilterSheetView(filterModel: festivalFilterModel)
}
```

`.task {}` 블록 내 `loadInitialDiscoverLayers` 호출 수정:

```swift
await viewModel.loadInitialDiscoverLayers(viewport: mapViewport, filter: festivalFilterModel.filter)
```

파일 내 나머지 `loadDiscoverLayers`·`setFestivalLayerVisible` 호출도 모두 `filter: festivalFilterModel.filter` 추가. 아래 패턴을 검색해 일괄 수정:

```bash
grep -n "loadDiscoverLayers\|setFestivalLayerVisible\|loadInitialDiscoverLayers" ios-app/Features/Map/MapHomeView.swift
```

예상 호출 위치:
- `handleCameraIdle` 내 `viewModel.loadDiscoverLayers(viewport: viewport, showsError: true)` → `filter: festivalFilterModel.filter` 추가
- 레이어 토글 버튼의 `viewModel.setFestivalLayerVisible(!viewModel.showsFestivalLayer, viewport: mapViewport)` → `filter: festivalFilterModel.filter` 추가
- `setExploreMode` 호출 경로의 `loadDiscoverLayers` 가 있으면 동일하게 추가 (ViewModel 내부 호출이면 `.default` 사용 중이므로 무관)

`.onDisappear { }` 다음 줄(또는 적절한 modifier 위치)에 필터 변경 감지 추가:

```swift
.onChange(of: festivalFilterModel.filter) { _ in
    guard viewModel.showsFestivalLayer else { return }
    discoverRefreshTask?.cancel()
    discoverRefreshTask = Task {
        await viewModel.loadDiscoverLayers(
            viewport: mapViewport,
            filter: festivalFilterModel.filter
        )
    }
}
```

- [ ] **Step 4: 빌드 확인**

```bash
xcodebuild build -project ios-app/ParkingLotNavigator.xcodeproj \
  -scheme ParkingLotNavigator -destination 'platform=iOS Simulator,name=iPhone 16' 2>&1 | grep -E "error:|BUILD"
```

예상: `BUILD SUCCEEDED`

- [ ] **Step 5: 커밋**

```bash
git add ios-app/Features/Map/MapHomeViewModel.swift ios-app/Features/Map/MapHomeView.swift
git commit -m "Wire festival filter to map tab: filter button, onChange reload, filter param in ViewModel"
```

---

## Task 5: FilterSheetView — 조회 기간 섹션 추가, status 섹션 제거

**Files:**
- Modify: `ios-app/Features/Calendar/FilterSheetView.swift`

**Interfaces:**
- Consumes: `FestivalFilter.dateRange`, `FestivalFilter.customFromDate`, `FestivalFilter.customToDate`, `FestivalDateRange.displayLabel`, `FestivalDateRange.allCases` (Task 1)

- [ ] **Step 1: dateRange 섹션 + DatePicker 헬퍼 추가**

`FilterSheetView` 구조체 안 `@State private var draft: FestivalFilter` 다음에 헬퍼 프로퍼티 추가:

```swift
private var today: Date { Calendar.current.startOfDay(for: Date()) }
private var maxCustomDate: Date {
    Calendar.current.date(byAdding: .year, value: 1, to: today) ?? today
}

private let customDateFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    f.locale = Locale(identifier: "en_US_POSIX")
    return f
}()

private var fromDate: Date {
    draft.customFromDate.flatMap { customDateFormatter.date(from: $0) } ?? today
}

private var toDate: Date {
    draft.customToDate.flatMap { customDateFormatter.date(from: $0) } ?? today
}

private func selectCustomFrom(_ date: Date) {
    draft.dateRange = .custom
    draft.customFromDate = customDateFormatter.string(from: date)
    if toDate < date {
        draft.customToDate = draft.customFromDate
    }
}

private func selectCustomTo(_ date: Date) {
    draft.dateRange = .custom
    draft.customToDate = customDateFormatter.string(from: date)
}
```

- [ ] **Step 2: `dateRangeSection` computed property 추가**

`FilterSheetView` 안 `radiusSection` 위에 추가:

```swift
private var dateRangeSection: some View {
    sectionWrapper(title: "조회 기간", subtitle: nil) {
        VStack(alignment: .leading, spacing: 8) {
            // 프리셋 칩 (custom 제외)
            RegionFlowLayout(spacing: 6) {
                ForEach(FestivalDateRange.allCases.filter { $0 != .custom }, id: \.self) { range in
                    chip(
                        label: range.displayLabel,
                        isOn: draft.dateRange == range && draft.dateRange != .custom
                    ) {
                        draft.dateRange = range
                        draft.customFromDate = nil
                        draft.customToDate = nil
                    }
                }
            }
            // 날짜 직접 선택 칩
            chip(label: "날짜 직접 선택", isOn: draft.dateRange == .custom) {
                if draft.dateRange != .custom {
                    draft.dateRange = .custom
                    draft.customFromDate = customDateFormatter.string(from: today)
                    draft.customToDate = customDateFormatter.string(from: today)
                }
            }
            // DatePicker (custom 선택 시 표시)
            if draft.dateRange == .custom {
                VStack(alignment: .leading, spacing: 6) {
                    DatePicker(
                        "시작일",
                        selection: Binding(
                            get: { fromDate },
                            set: { selectCustomFrom($0) }
                        ),
                        in: today...maxCustomDate,
                        displayedComponents: .date
                    )
                    .datePickerStyle(.compact)
                    .environment(\.locale, Locale(identifier: "ko_KR"))
                    .font(.festival(size: 13))

                    DatePicker(
                        "종료일",
                        selection: Binding(
                            get: { toDate },
                            set: { selectCustomTo($0) }
                        ),
                        in: fromDate...maxCustomDate,
                        displayedComponents: .date
                    )
                    .datePickerStyle(.compact)
                    .environment(\.locale, Locale(identifier: "ko_KR"))
                    .font(.festival(size: 13))
                }
                .padding(10)
                .background(FestivalDesign.cream.opacity(0.5))
                .clipShape(FestivalDesign.chipShape)
            }
        }
    }
}
```

- [ ] **Step 3: `body`의 섹션 순서 수정 + `statusSection` 제거**

`body` 내 `VStack` 교체:

```swift
VStack(alignment: .leading, spacing: 24) {
    dateRangeSection   // ← 최상단 신규
    radiusSection
    regionSection
    categorySection
    // statusSection 제거
}
```

파일에서 `statusSection` computed property 전체 삭제.

`toggle(status:)` private 메서드 삭제.

- [ ] **Step 4: `초기화` 버튼 동작 확인**

`초기화` 버튼은 `draft = .default`이므로 자동으로 `.ongoingOnly`, `customFromDate = nil`이 된다. 별도 수정 불필요.

- [ ] **Step 5: 빌드 + 전체 테스트 통과 확인**

```bash
xcodebuild test -project ios-app/ParkingLotNavigator.xcodeproj \
  -scheme ParkingLotNavigator -destination 'platform=iOS Simulator,name=iPhone 16' 2>&1 | tail -15
```

예상: `** TEST SUCCEEDED **`

- [ ] **Step 6: 커밋**

```bash
git add ios-app/Features/Calendar/FilterSheetView.swift
git commit -m "Add date range section to FilterSheetView, remove status section"
```

---

## Task 6: 빌드번호 올리기 + push

**Files:**
- Modify: `ios-app/project.yml`

- [ ] **Step 1: 빌드번호 176 → 177**

`ios-app/project.yml` 내 `CURRENT_PROJECT_VERSION: 176` → `CURRENT_PROJECT_VERSION: 177`

- [ ] **Step 2: 전체 테스트 최종 확인**

```bash
xcodebuild test -project ios-app/ParkingLotNavigator.xcodeproj \
  -scheme ParkingLotNavigator -destination 'platform=iOS Simulator,name=iPhone 16' 2>&1 | tail -5
```

예상: `** TEST SUCCEEDED **`

- [ ] **Step 3: 커밋 + push**

```bash
git add ios-app/project.yml
git commit -m "Bump build to 177 (festival filter overhaul)"
git push origin master
```
