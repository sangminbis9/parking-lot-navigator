# 축제 필터 개편 설계

날짜: 2026-06-25

## 목표

- 축제 조회 기간을 기존 90일 고정에서 최대 1년으로 확장
- 지도 탭과 캘린더 탭이 동일한 필터를 공유 (한쪽 설정이 반대쪽에 즉시 반영)
- 필터 시트 최상단에 기간 선택 섹션 추가 (프리셋 칩 + 날짜 직접 선택)
- 기존 "진행 상태" 섹션 제거 (기간 섹션이 대체)

---

## 데이터 모델

### `FestivalDateRange` (신규)

`FestivalFilterStore.swift`에 추가.

```swift
enum FestivalDateRange: String, Codable, CaseIterable {
    case ongoingOnly   // 진행중    → upcomingWithinDays: 0,   client: .ongoing만
    case oneMonth      // 1개월 이내 → upcomingWithinDays: 30
    case twoMonths     // 2개월 이내 → upcomingWithinDays: 60
    case threeMonths   // 3개월 이내 → upcomingWithinDays: 90
    case sixMonths     // 6개월 이내 → upcomingWithinDays: 180
    case oneYear       // 1년 이내  → upcomingWithinDays: 365
    case custom        // 날짜 직접 선택 → customFromDate / customToDate 사용
}
```

`upcomingWithinDays` 계산 프로퍼티:

```swift
var upcomingWithinDays: Int {
    switch self {
    case .ongoingOnly: return 0
    case .oneMonth:    return 30
    case .twoMonths:   return 60
    case .threeMonths: return 90
    case .sixMonths:   return 180
    case .oneYear, .custom: return 365
    }
}
```

`.custom`은 API를 넓게(365일) 호출한 뒤 클라이언트에서 날짜 겹침으로 2차 필터링.

### `FestivalFilter` 변경

기존 `statuses: [DiscoverStatus]` 제거. 아래 필드 추가.

```swift
var dateRange: FestivalDateRange   // 기본값: .ongoingOnly
var customFromDate: String?        // "yyyy-MM-dd", .custom일 때만 사용
var customToDate: String?          // "yyyy-MM-dd", .custom일 때만 사용
```

`default` 변경:
```swift
static let default = FestivalFilter(
    regions: [], radiusKm: 50, primaryCategories: [],
    dateRange: .ongoingOnly, customFromDate: nil, customToDate: nil
)
```

`isEmpty` 변경:
```swift
var isEmpty: Bool {
    regions.isEmpty && primaryCategories.isEmpty
    && dateRange == .ongoingOnly
    && radiusKm == FestivalFilter.default.radiusKm
}
```
(`statuses.isEmpty` 조건 제거, `dateRange == .ongoingOnly`가 기본값이므로 isEmpty=true로 처리.)

### `matches()` 변경

```
.ongoingOnly  → festival.status == .ongoing 인 것만 통과
.upcoming(N)  → 제한 없음 (API가 upcomingWithinDays로 제한)
.custom       → festival 기간이 [customFromDate, customToDate]와 하루라도 겹치는 것만
```

날짜 겹침 조건: `festival.startDate <= customToDate && (festival.endDate ?? festival.startDate) >= customFromDate`

### Codable 호환성

`statuses`를 `decodeIfPresent`로 읽던 기존 저장 필터는 decode 시 무시됨. `dateRange`는 존재하지 않으면 `.ongoingOnly`(기본값)로 초기화 — 사용자 영향 없음.

---

## API 레이어

### `APIClientProtocol` 변경

```swift
func nearbyFestivals(lat: Double, lng: Double, radiusMeters: Int, upcomingWithinDays: Int) async throws -> [Festival]
```

### `APIClient` 구현

기존 하드코딩 `"90"` → 파라미터 전달:

```swift
URLQueryItem(name: "upcomingWithinDays", value: String(upcomingWithinDays))
```

### `MockAPIClient`

파라미터 추가, 기존 mock 응답 유지.

Worker는 이미 `upcomingWithinDays: 0–365`를 지원. 변경 없음.

---

## 필터 상태 공유

### `FestivalFilterModel` → `AppRootView` EnvironmentObject

```
AppRootView
  @StateObject festivalFilterModel   (scope: "shared", appGroupID: ...)
  └─ .environmentObject(festivalFilterModel)
       ├─ CalendarTabView   @EnvironmentObject var filterModel: FestivalFilterModel
       └─ MapHomeView       @EnvironmentObject var filterModel: FestivalFilterModel
```

`CalendarTabView`:
- `@StateObject private var filterModel` → `@EnvironmentObject var filterModel`
- `init`에서 `FestivalFilterModel(scope:appGroupID:)` 생성 코드 제거

`FestivalSyncService`:
- `FestivalFilterStore.load(scope: "calendar", ...)` → `scope: "shared"`

기존 `"calendar"` scope로 저장된 값은 더 이상 로드하지 않으나 동작에 영향 없음(기본값 적용).

---

## 지도 탭 변경

### `MapHomeView`

1. `discoverLayerToggles` 오른쪽 끝에 필터 버튼 추가:
   - `Image(systemName: "slider.horizontal.3")` + `coral` 색상
   - 탭 → `FilterSheetView(filterModel: filterModel)` sheet 표시
   - 기존 필터 활성(기본값 이외) 상태이면 badge dot 표시

2. `.onChange(of: filterModel.filter)`:
   - `showsFestivalLayer`가 켜져 있으면 → 축제 레이어 재로드

### `MapHomeViewModel`

`discoverFestivals(viewport:filter:)` 시그니처 추가:

```swift
private func discoverFestivals(viewport: MapViewport, filter: FestivalFilter) async throws -> [Festival] {
    return try await apiClient.nearbyFestivals(
        lat: viewport.center.latitude,
        lng: viewport.center.longitude,
        radiusMeters: viewportDiscoverRadiusMeters(for: viewport),
        upcomingWithinDays: filter.dateRange.upcomingWithinDays
    )
}
```

결과에 `filter.matches()`로 클라이언트 2차 필터링 (`.custom` 날짜 겹침, `.ongoingOnly` status 필터).

`setFestivalLayerVisible(visible:viewport:filter:)` 및 `loadInitialDiscoverLayers(viewport:filter:)` 등 축제를 가져오는 모든 ViewModel 메서드에 `filter: FestivalFilter` 파라미터를 추가한다. `MapHomeView`가 `filterModel.filter`를 전달한다.

---

## 필터 시트 UI

### 섹션 구조

```
┌─ 조회 기간 ──────────────────────────────────┐
│  [진행중] [1개월] [2개월] [3개월] [6개월] [1년]  │
│                                                │
│  [📅 날짜 직접 선택]  ← 단일 칩, 누르면 아래 펼침 │
│    시작일  [2026. 7. 1 ▾]                      │
│    종료일  [2026. 7. 20 ▾]                     │
└────────────────────────────────────────────────┘
[거리 반경]   ← 기존 유지
[지역]        ← 기존 유지
[카테고리]    ← 기존 유지
```

기존 **"진행 상태"** 섹션 제거.

### 동작 규칙

- 프리셋 칩(진행중~1년) 선택 → `draft.dateRange = 선택값`, `customFromDate = nil`, `customToDate = nil`, 날짜 입력 영역 접힘
- "날짜 직접 선택" 칩 탭 또는 날짜 입력 시 → `draft.dateRange = .custom`, 프리셋 칩 해제
- 날짜 범위: `min = today`, `max = today + 365일`
- `customToDate`가 `customFromDate`보다 앞이면 자동 조정 (`toDate = fromDate`)
- 초기화 버튼 → `draft = .default` (`.ongoingOnly`, 날짜 nil)

### DatePicker 스타일

```swift
DatePicker("시작일", selection: $draft.fromDateBinding, in: today...maxDate, displayedComponents: .date)
    .datePickerStyle(.compact)
    .environment(\.locale, Locale(identifier: "ko_KR"))
```

`customFromDate/customToDate`(String)와 DatePicker(Date) 사이는 `Binding` 변환 헬퍼로 처리.

---

## 변경 파일 목록

| 파일 | 변경 내용 |
|---|---|
| `Core/Storage/FestivalFilterStore.swift` | `FestivalDateRange` enum 추가, `statuses` 제거, `dateRange`·날짜 필드 추가, `matches()` 수정 |
| `Core/Networking/APIClient.swift` | `nearbyFestivals` 시그니처 + URL 파라미터 |
| `App/AppRootView.swift` | `FestivalFilterModel` StateObject 생성 + EnvironmentObject 주입 |
| `Features/Calendar/CalendarTabView.swift` | `@StateObject` → `@EnvironmentObject`, init 단순화 |
| `Features/Calendar/FestivalFilterModel.swift` | 변경 없음 (그대로 사용) |
| `Core/Services/FestivalSyncService.swift` | scope `"calendar"` → `"shared"` |
| `Features/Map/MapHomeView.swift` | 필터 버튼 추가, `.onChange` 재로드 |
| `Features/Map/MapHomeViewModel.swift` | `discoverFestivals()` filter 파라미터 추가 |
| `Features/Calendar/FilterSheetView.swift` | 기간 섹션 추가, 날짜 선택 UI, 기존 status 섹션 제거 |

Worker 변경 없음.
iOS 빌드 필요.
