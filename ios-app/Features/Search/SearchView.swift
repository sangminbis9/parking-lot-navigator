import CoreLocation
import SwiftUI
import UIKit

/// 축제·이벤트 동시 조회의 판단 규칙. `SearchView`의 `@State`에서 떼어 둬야
/// 실패 조합(축제만 / 이벤트만 / 둘 다)과 중복 로드 방지를 테스트로 못 박을 수 있다.
enum DiscoverLoad {
    enum Outcome: Equatable {
        /// 최소 한쪽은 받았다. 한쪽만 실패했으면 목록 위에 짧은 안내를 띄운다.
        case loaded(partialNotice: String?)
        /// 둘 다 실패했지만 이미 보여 주던 목록이 있다. 에러 화면으로 덮지 않는다.
        case failedWithExistingItems(notice: String)
        /// 둘 다 실패했고 보여 줄 것도 없다. 이때만 전체 오류 화면이다.
        case failed
    }

    static func outcome(festivalsLoaded: Bool, eventsLoaded: Bool, hasExistingItems: Bool) -> Outcome {
        if festivalsLoaded || eventsLoaded {
            let notice = (festivalsLoaded && eventsLoaded) ? nil : "일부 정보를 불러오지 못했습니다"
            return .loaded(partialNotice: notice)
        }
        return hasExistingItems ? .failedWithExistingItems(notice: "최신 정보를 불러오지 못했습니다") : .failed
    }

    /// .onAppear와 탭 전환이 잇달아 같은 전국 조회를 시작하는 것을 막는다.
    /// 강제 재시도는 진행 중인 조회가 있어도 통과한다.
    static func shouldStart(force: Bool, hasItems: Bool, isStale: Bool, isInFlight: Bool) -> Bool {
        guard force || !hasItems || isStale else { return false }
        return force || !isInFlight
    }

    /// 공연 이벤트를 기존 목록 뒤에 합친다. 새로 붙는 것이 없으면 nil - 목록을 건드리지 않는다.
    static func merging(_ events: [FreeEvent], performanceEvents: [FreeEvent]) -> [FreeEvent]? {
        var seenIds = Set(events.map(\.id))
        var merged = events
        for event in performanceEvents where seenIds.insert(event.id).inserted {
            merged.append(event)
        }
        return merged.count == events.count ? nil : merged
    }
}

struct SearchView: View {
    let apiClient: APIClientProtocol
    @EnvironmentObject private var router: Router
    @EnvironmentObject private var tabRouter: AppTabRouter
    @EnvironmentObject private var destinationStore: DestinationStore
    @State private var festivals: [Festival] = []
    @State private var events: [FreeEvent] = []
    @State private var query = ""
    @State private var debouncedQuery = ""
    @State private var isLoading = false
    /// 마지막 성공 시각. 탭을 다시 열어도 이만큼 지나기 전에는 다시 부르지 않는다.
    @State private var lastLoadedAt: Date?
    @State private var errorMessage: String?
    /// 축제·이벤트 중 한쪽만 실패했을 때 목록 위에 띄우는 짧은 안내. 전체 실패와 구분한다.
    @State private var partialLoadNotice: String?
    @State private var isLoadInFlight = false
    @State private var selectedKind: DiscoverTabKind = .all
    // 위치를 아직 모를 때 거리순은 사용자와의 거리가 아니라 전국 중심 기준 거리라 의미가 없다.
    @State private var sort: DiscoverTabSort = .ongoing
    @State private var hasChosenSort = false
    @StateObject private var locationProvider = UserLocationProvider()
    @State private var filters = DiscoverTabFilters()
    @State private var showsFilters = false
    @State private var visibleItemCount = 20
    @State private var loadTask: Task<Void, Never>?
    @State private var queryDebounceTask: Task<Void, Never>?
    @State private var allItems: [DiscoverTabItem] = []
    @State private var filteredItems: [DiscoverTabItem] = []
    @State private var availableFestivalCategories: [FestivalPrimaryCategory] = []
    @State private var availableEventCategories: [LocalEventPrimaryCategory] = []
    @FocusState private var isSearchFocused: Bool
    @ScaledMetric(relativeTo: .subheadline) private var searchFieldHeight: CGFloat = 32
    @State private var showsScrollToTop = false

    private let koreaCenter = CLLocationCoordinate2D(latitude: 36.35, longitude: 127.80)
    private let discoverRadiusMeters = 460_000
    private let pageSize = 20
    /// 이 시간이 지나야 다시 조회한다. 탭 전환마다 전국 데이터를 다시 받지 않기 위한 값.
    private let staleInterval: TimeInterval = 600
    private let queryDebounceNanoseconds: UInt64 = 250_000_000

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    discoverHeader
                        .id(Self.topAnchorID)

                    VStack(spacing: 10) {
                        searchField
                        discoverControls
                        locationNotice
                    }
                    .padding(12)
                    .festivalCard()

                    if isLoading {
                        LoadingStateView(text: "축제와 이벤트를 불러오는 중입니다")
                            .frame(height: 130)
                            .padding()
                            .festivalCard()
                    }

                    if let errorMessage {
                        FailureStateView(message: errorMessage) {
                            retryDiscoverDownload()
                        }
                        .festivalCard()
                    }

                    if let partialLoadNotice {
                        HStack(spacing: 8) {
                            Text(partialLoadNotice)
                                .font(.festival(.caption))
                                .foregroundStyle(FestivalDesign.secondaryText)
                            Spacer(minLength: 8)
                            Button("다시 시도") {
                                retryDiscoverDownload()
                            }
                            .font(.festival(.caption, weight: .semibold))
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("discover-partial-retry")
                        }
                        .padding(12)
                        .festivalCard()
                        .accessibilityIdentifier("discover-partial-notice")
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        Text("\(filteredItems.count)개")
                            .font(.festival(.caption, weight: .semibold))
                            .foregroundStyle(FestivalDesign.secondaryText)

                        activeFilterChips

                        if filteredItems.isEmpty && !isLoading {
                            emptyState
                        } else {
                            LazyVStack(spacing: 10) {
                                ForEach(visibleItems) { item in
                                    Button {
                                        isSearchFocused = false
                                        destinationStore.addRecent(item.destination)
                                        router.showResults(for: item.destination, presentation: item.presentation)
                                    } label: {
                                        DiscoverTabRow(item: item)
                                            .padding(12)
                                            .festivalCard()
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityIdentifier("discover-row")
                                }

                                if visibleItems.count < filteredItems.count {
                                    ProgressView()
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, 16)
                                        .onAppear {
                                            loadMoreVisibleItems()
                                        }
                                }
                            }
                        }
                    }
                    .contentShape(Rectangle())
                    .simultaneousGesture(TapGesture().onEnded {
                        isSearchFocused = false
                    })
                }
                .padding(16)
                .background(
                    GeometryReader { geo in
                        Color.clear.preference(
                            key: DiscoverScrollOffsetKey.self,
                            value: -geo.frame(in: .named(Self.scrollSpace)).minY
                        )
                    }
                )
            }
            .coordinateSpace(name: Self.scrollSpace)
            .onPreferenceChange(DiscoverScrollOffsetKey.self) { offset in
                // 한 화면 넘게 내려갔을 때만 노출한다. 값이 경계에서 떨릴 수 있어 상태가 달라질 때만 갱신.
                let shouldShow = offset > 600
                guard shouldShow != showsScrollToTop else { return }
                withAnimation(.easeOut(duration: FestivalDesign.Motion.standard)) {
                    showsScrollToTop = shouldShow
                }
            }
            .overlay(alignment: .bottomTrailing) {
                if showsScrollToTop {
                    Button {
                        isSearchFocused = false
                        withAnimation(.easeOut(duration: 0.3)) {
                            proxy.scrollTo(Self.topAnchorID, anchor: .top)
                        }
                    } label: {
                        ScrollToTopBadge()
                    }
                    .buttonStyle(.plain)
                    .padding(.trailing, 16)
                    .padding(.bottom, 20)
                    .transition(.scale(scale: 0.85).combined(with: .opacity))
                    .accessibilityLabel("목록 맨 위로")
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .background(FestivalDesign.background.ignoresSafeArea())
            .festivalNavigationTitle("축제 / 이벤트")
            .onAppear {
                applyPendingDiscoverFilter()
                startDiscoverLoad()
            }
            .onReceive(NotificationCenter.default.publisher(for: .discoverySnapshotChanged).receive(on: RunLoop.main)) { _ in
                startDiscoverLoad(force: true)
            }
            .onChange(of: tabRouter.selectedTab) { selectedTab in
                guard selectedTab == .discover else { return }
                applyPendingDiscoverFilter()
                startDiscoverLoad()
            }
            .onChange(of: tabRouter.discoverFilterQuery) { _ in
                applyPendingDiscoverFilter()
            }
            .onChange(of: locationProvider.coordinate?.latitude) { latitude in
                // 좌표가 들어오면 그때 거리순으로 올린다. 사용자가 정렬을 직접 고른 뒤에는 건드리지 않는다.
                if latitude != nil, !hasChosenSort, sort != .distance {
                    sort = .distance
                } else if sort == .distance {
                    recomputeFilteredItems()
                }
            }
            .onChange(of: query) { newValue in
                scheduleQueryDebounce(newValue)
            }
            .onChange(of: debouncedQuery) { _ in
                resetVisibleItems()
                recomputeFilteredItems()
            }
            .onChange(of: selectedKind) { _ in
                resetVisibleItems()
                recomputeFilteredItems()
            }
            .onChange(of: sort) { _ in
                resetVisibleItems()
                recomputeFilteredItems()
            }
            .onChange(of: filters) { _ in
                resetVisibleItems()
                recomputeFilteredItems()
            }
            .sheet(isPresented: $showsFilters) {
                DiscoverTabFilterSheet(
                    applied: $filters,
                    kind: selectedKind,
                    festivalCategories: availableFestivalCategories,
                    eventCategories: availableEventCategories
                )
            }
        }
    }

    private static let topAnchorID = "discover-top"
    private static let scrollSpace = "discover-scroll"

    private func applyPendingDiscoverFilter() {
        guard let filter = tabRouter.discoverFilterQuery else { return }
        query = filter
        tabRouter.discoverFilterQuery = nil
    }

    private var discoverHeader: some View {
        HStack(spacing: 10) {
            Image("FestivalMascotGuide")
                .resizable()
                .scaledToFit()
                .frame(width: 48, height: 48)
                .accessibilityHidden(true)

            Text("장소를 고르면 근처 주차장을 바로 추천합니다.")
                .font(.festival(.subheadline))
                .foregroundStyle(FestivalDesign.secondaryText)
            Spacer(minLength: 0)
        }
    }

    private var searchField: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(FestivalDesign.tealText)
            TextField(
                "",
                text: $query,
                prompt: Text("축제, 이벤트, 장소 검색")
                    .foregroundColor(FestivalDesign.secondaryText)
            )
            .font(.festival(.subheadline))
            .focused($isSearchFocused)
            .textInputAutocapitalization(.never)
            .submitLabel(.search)

            if !query.isEmpty {
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(FestivalDesign.secondaryText)
                        .frame(width: 44, height: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("검색어 지우기")
            }
        }
        // 지우기 버튼(높이 32)이 나타났다 사라져도 검색란 높이가 흔들리지 않게 고정한다.
        .frame(height: searchFieldHeight)
    }

    private var discoverControls: some View {
        VStack(alignment: .leading, spacing: 10) {
            // 분류가 5개라 한 줄에 균등 분할하면 "가게 이벤트"가 잘린다. 지도 토글처럼 가로 스크롤.
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(DiscoverTabKind.allCases) { kind in
                        Button {
                            selectedKind = kind
                        } label: {
                            Label(kind.title, systemImage: kind.systemImage)
                                .font(.festival(.caption, weight: .bold))
                                .lineLimit(1)
                        }
                        .buttonStyle(DiscoverSegmentButtonStyle(isSelected: selectedKind == kind, tint: kind.tint))
                    }
                }
            }

            HStack(spacing: 8) {
                Menu {
                    Picker("정렬", selection: Binding(get: { sort }, set: { newValue in
                        sort = newValue
                        hasChosenSort = true
                    })) {
                        ForEach(DiscoverTabSort.allCases) { option in
                            Text(option.title).tag(option)
                        }
                    }
                } label: {
                    Label(sort.title, systemImage: "arrow.up.arrow.down")
                        .font(.festival(.caption, weight: .semibold))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(DiscoverControlButtonStyle(tint: FestivalDesign.teal, isActive: false))

                Button {
                    showsFilters = true
                } label: {
                    Label(filters.hasFilters ? "필터 \(filters.count)" : "필터", systemImage: filters.hasFilters ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                        .font(.festival(.caption, weight: .semibold))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(DiscoverControlButtonStyle(tint: FestivalDesign.coral, isActive: filters.hasFilters))
            }
        }
    }

    /// 위치 권한이 없으면 거리순이 실제 거리가 아니게 된다. 그 사실과 해결 경로를 같이 알린다.
    /// 아직 권한을 묻지 않은 상태에서는 시스템 팝업 대신 이 안내가 먼저 뜬다.
    @ViewBuilder
    private var locationNotice: some View {
        if locationProvider.authorizationStatus == .notDetermined {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "location.circle")
                    .font(.festival(.caption, weight: .bold))
                    .foregroundStyle(FestivalDesign.coralText)
                VStack(alignment: .leading, spacing: 2) {
                    Text("내 주변 순으로 볼까요?")
                        .font(.festival(.caption, weight: .bold))
                        .foregroundStyle(FestivalDesign.navy)
                    Text("지금은 진행중 우선으로 보여 주고 있어요. 위치를 켜지 않아도 필터에서 지역을 고를 수 있어요.")
                        .font(.festival(.caption2))
                        .foregroundStyle(FestivalDesign.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Button("위치 켜기") { locationProvider.request() }
                    .font(.festival(.caption, weight: .bold))
                    .buttonStyle(.plain)
                    .foregroundStyle(FestivalDesign.tealText)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(FestivalDesign.cream.opacity(0.7))
            .clipShape(FestivalDesign.controlShape)
        } else if locationProvider.authorizationStatus == .denied || locationProvider.authorizationStatus == .restricted {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "location.slash")
                    .font(.festival(.caption, weight: .bold))
                    .foregroundStyle(FestivalDesign.coralText)
                VStack(alignment: .leading, spacing: 2) {
                    Text("위치 권한이 꺼져 있어요")
                        .font(.festival(.caption, weight: .bold))
                        .foregroundStyle(FestivalDesign.navy)
                    Text("거리순 대신 진행중 우선으로 보여 주고 있어요. 필터에서 지역을 골라 주세요.")
                        .font(.festival(.caption2))
                        .foregroundStyle(FestivalDesign.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Button("설정 열기") {
                    guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
                    UIApplication.shared.open(url)
                }
                .font(.festival(.caption, weight: .bold))
                .buttonStyle(.plain)
                .foregroundStyle(FestivalDesign.tealText)
            }
            .padding(10)
            .background(FestivalDesign.cream.opacity(0.6))
            .clipShape(FestivalDesign.controlShape)
        }
    }

    @ViewBuilder
    private var activeFilterChips: some View {
        let chips = activeFilterLabels
        if !chips.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(chips, id: \.self) { label in
                        Text(label)
                            .font(.festival(.caption, weight: .semibold))
                            .foregroundStyle(FestivalDesign.coralText)
                            .padding(.horizontal, 9)
                            .padding(.vertical, 5)
                            .background(FestivalDesign.cream.opacity(0.55))
                            .clipShape(FestivalDesign.controlShape)
                    }
                    Button {
                        filters = DiscoverTabFilters()
                    } label: {
                        Label("초기화", systemImage: "xmark.circle.fill")
                            .font(.festival(.caption, weight: .semibold))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(FestivalDesign.secondaryText)
                }
            }
        }
    }

    private var emptyState: some View {
        let hasQuery = !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return VStack(spacing: 12) {
            Image("FestivalMascotNight")
                .resizable()
                .scaledToFit()
                .frame(width: 132, height: 132)
                .accessibilityHidden(true)
            Text(hasQuery ? "검색 결과가 없습니다" : "표시할 항목이 없습니다")
                .font(.festival(.headline))
                .foregroundStyle(FestivalDesign.navy)
            Text(hasQuery ? "다른 검색어로 찾아보세요." : "잠시 후 다시 확인해 주세요.")
                .font(.festival(.subheadline))
                .foregroundStyle(FestivalDesign.secondaryText)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 30)
        .festivalCard()
    }

    private var visibleItems: [DiscoverTabItem] {
        Array(filteredItems.prefix(visibleItemCount))
    }

    private func rebuildAllItems() {
        // KOPIS 공연은 /api/festivals와 /api/performances에 같은 id로 함께 들어온다.
        // 그대로 합치면 목록에 같은 공연이 두 번 나오므로 공연 응답 쪽만 남긴다.
        let eventIds = Set(events.map(\.id))
        let items = festivals.filter { !eventIds.contains($0.id) }.map(DiscoverTabItem.festival)
            + events.map(DiscoverTabItem.event)
        allItems = items
        availableFestivalCategories = FestivalPrimaryCategory.allCases.filter { category in
            items.contains { $0.festivalCategory == category }
        }
        availableEventCategories = LocalEventPrimaryCategory.allCases.filter { category in
            items.contains { $0.eventCategory == category }
        }
        recomputeFilteredItems()
    }

    private func recomputeFilteredItems() {
        let trimmed = debouncedQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        // 지난 행사는 목록을 둘러볼 때는 숨기고, 이름으로 찾을 때만 보여 준다.
        let searched = trimmed.isEmpty
            ? allItems.filter { $0.status != .ended }
            : allItems.filter { $0.searchText.contains(trimmed) }
        let bounds = filters.dateBounds()
        let scoped = searched
            .filter { selectedKind.includes($0) }
            .filter { filters.includes($0, bounds: bounds) }

        let sorted: [DiscoverTabItem]
        if case .distance = sort, let coord = locationProvider.coordinate {
            // 거리순 정렬: 비교마다 CLLocation을 생성하면 O(n log n) 할당 → 미리 1회 계산
            let userLoc = CLLocation(latitude: coord.latitude, longitude: coord.longitude)
            sorted = scoped
                .map { ($0, CLLocation(latitude: $0.lat, longitude: $0.lng).distance(from: userLoc)) }
                .sorted { $0.1 < $1.1 }
                .map(\.0)
        } else {
            sorted = scoped.sorted(by: sort.comparator(userLocation: locationProvider.coordinate))
        }
        // 어떤 정렬이든 지난 행사는 맨 뒤로 보낸다.
        filteredItems = sorted.filter { $0.status != .ended } + sorted.filter { $0.status == .ended }
    }

    private func scheduleQueryDebounce(_ newValue: String) {
        queryDebounceTask?.cancel()
        queryDebounceTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: queryDebounceNanoseconds)
            guard !Task.isCancelled else { return }
            debouncedQuery = newValue
        }
    }

    private var activeFilterLabels: [String] {
        var dateLabels: [String] = []
        if filters.dateRange == .custom, let from = filters.customFromDate, let to = filters.customToDate {
            dateLabels = ["\(from) ~ \(to)"]
        } else if filters.dateRange != DiscoverTabFilters.defaultDateRange {
            dateLabels = [filters.dateRange.displayLabel]
        }
        let festivalLabels = filters.selectedFestivalCategories.map(\.displayName).sorted()
        let eventLabels = filters.selectedEventCategories.map(\.displayName).sorted()
        return dateLabels
            + festivalLabels
            + eventLabels
            + filters.selectedRegions.map(NotificationRegionKey.displayName)
    }

    private func retryDiscoverDownload() {
        guard tabRouter.selectedTab == .discover else { return }
        loadTask?.cancel()
        isLoadInFlight = true
        isLoading = festivals.isEmpty && events.isEmpty
        loadTask = Task {
            try? await apiClient.refreshDiscoverySnapshot()
            guard !Task.isCancelled else { return }
            await loadDiscoverItems(showsSpinner: false)
            if !Task.isCancelled { isLoadInFlight = false }
        }
    }

    private func startDiscoverLoad(force: Bool = false) {
        guard tabRouter.selectedTab == .discover else { return }
        let hasItems = !(festivals.isEmpty && events.isEmpty)
        let isStale = lastLoadedAt.map { Date().timeIntervalSince($0) > staleInterval } ?? true
        // .onAppear와 탭 전환이 잇달아 같은 전국 조회를 시작해, 받는 중이던 수 MB 응답을
        // 취소하고 처음부터 다시 받는 일이 있었다. 강제 재시도가 아니면 진행 중인 조회를 그대로 둔다.
        guard DiscoverLoad.shouldStart(force: force, hasItems: hasItems, isStale: isStale, isInFlight: isLoadInFlight) else { return }
        loadTask?.cancel()
        isLoadInFlight = true
        loadTask = Task { @MainActor in
            // 이미 목록이 있으면 화면을 비우지 않고 뒤에서만 갱신한다.
            await loadDiscoverItems(showsSpinner: force || !hasItems)
            // 강제 재시도가 앞 작업을 취소한 경우에는 새 작업의 플래그를 내리면 안 된다.
            if !Task.isCancelled { isLoadInFlight = false }
        }
    }

    private func resetVisibleItems() {
        visibleItemCount = pageSize
    }

    private func loadMoreVisibleItems() {
        guard visibleItemCount < filteredItems.count else { return }
        visibleItemCount = min(visibleItemCount + pageSize, filteredItems.count)
    }

    private func loadDiscoverItems(showsSpinner: Bool) async {
        if showsSpinner { isLoading = true }
        errorMessage = nil
        partialLoadNotice = nil

        // 종료 30일 안의 축제도 받아 둔다. 검색어가 있을 때만 "지난 행사"로 보여 준다.
        async let festivalItems = apiClient.nearbyFestivals(
            lat: koreaCenter.latitude,
            lng: koreaCenter.longitude,
            radiusMeters: discoverRadiusMeters,
            upcomingWithinDays: 365,
            pastWithinDays: FestivalFavoritesStore.endedRetentionDays
        )
        async let eventItems = apiClient.nearbyEvents(
            lat: koreaCenter.latitude,
            lng: koreaCenter.longitude,
            radiusMeters: discoverRadiusMeters
        )
        // 공연 분류는 KOPIS 공연을 포함해야 지도 공연 레이어와 같은 목록이 된다.
        // 셋 중 가장 느린 호출이라 축제·이벤트를 먼저 그린 뒤 도착하는 대로 합친다.
        async let performanceItems = apiClient.nearbyPerformances(
            lat: koreaCenter.latitude,
            lng: koreaCenter.longitude,
            radiusMeters: discoverRadiusMeters,
            upcomingWithinDays: 365
        )

        // 한쪽이 실패해도 나머지는 살린다. 예전에는 둘 중 하나만 실패해도 탭 전체가 오류 화면이 됐다.
        var loadedFestivals: [Festival]?
        var loadedEvents: [FreeEvent]?
        var failure: Error?
        do {
            loadedFestivals = try await festivalItems
        } catch {
            failure = error
        }
        do {
            loadedEvents = try await eventItems
        } catch {
            if failure == nil { failure = error }
        }

        guard !Task.isCancelled, tabRouter.selectedTab == .discover else { return }

        let outcome = DiscoverLoad.outcome(
            festivalsLoaded: loadedFestivals != nil,
            eventsLoaded: loadedEvents != nil,
            hasExistingItems: !(festivals.isEmpty && events.isEmpty)
        )
        switch outcome {
        case .failed:
            errorMessage = NetworkErrorMessage.text(for: failure ?? URLError(.unknown), subject: "축제와 이벤트 정보")
            isLoading = false
            _ = try? await performanceItems
            return
        case .failedWithExistingItems(let notice):
            // 뒤에서 갱신하다 실패한 경우에는 이미 보여 주던 목록을 에러 카드로 덮지 않는다.
            partialLoadNotice = notice
            isLoading = false
            _ = try? await performanceItems
            return
        case .loaded(let notice):
            partialLoadNotice = notice
        }

        if let loadedFestivals { festivals = loadedFestivals }
        if let loadedEvents { events = loadedEvents }
        // 한쪽이라도 받았으면 갱신 시각을 남긴다. 탭을 오갈 때마다 전국 조회를 다시 때리지 않기 위해서다.
        lastLoadedAt = Date()
        resetVisibleItems()
        rebuildAllItems()
        // 공연을 기다리느라 화면 전체를 잡아 두지 않는다.
        isLoading = false

        // 음악·공연 축제는 /api/festivals에도 들어 있어 이벤트만 합친다.
        // 공연만 실패하면 목록은 그대로 두고 안내도 띄우지 않는다 - 보조 병합이라 나머지가 온전하다.
        let loadedPerformances = try? await performanceItems
        guard !Task.isCancelled, tabRouter.selectedTab == .discover else { return }
        guard let performanceEvents = loadedPerformances?.events, !performanceEvents.isEmpty else { return }
        guard let mergedEvents = DiscoverLoad.merging(events, performanceEvents: performanceEvents) else { return }
        events = mergedEvents
        // 여기서는 resetVisibleItems()를 부르지 않는다. 보던 위치를 지키기 위해서다.
        rebuildAllItems()
    }
}

private struct DiscoverScrollOffsetKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

/// 목록이 길어졌을 때 뜨는 "맨 위로" 알약. 카드 위에 떠 있어야 해서 채움 + 그림자로 띄운다.
private struct ScrollToTopBadge: View {
    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "arrow.up")
                .font(.festival(.caption, weight: .bold))
            Text("맨 위로")
                .font(.festival(.caption, weight: .bold))
        }
        .foregroundStyle(FestivalDesign.onFill(FestivalDesign.teal))
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(FestivalDesign.chipShape.fill(FestivalDesign.teal))
        .overlay(
            FestivalDesign.chipShape
                .stroke(FestivalDesign.surface.opacity(0.85), lineWidth: 2)
        )
        .festivalShadow(.high)
    }
}

struct DiscoverTabItem: Identifiable {
    enum Kind {
        case festival(Festival)
        case event(FreeEvent)
    }

    let id: String
    let kind: Kind
    let title: String
    let subtitle: String
    let address: String
    let dateText: String
    let startDate: String
    let endDate: String
    let status: DiscoverStatus
    /// 축제·공연·박람회·가게 이벤트를 가르는 단일 기준. 종류 배지 문구·색과 토글 분류가 모두 여기서 나온다.
    let domain: DiscoverDomain
    let imageUrl: String?
    let searchText: String
    let destination: Destination
    let presentation: DiscoverPresentation
    let tags: [String]
    let festivalCategory: FestivalPrimaryCategory?
    let eventCategory: LocalEventPrimaryCategory?
    let lat: Double
    let lng: Double
    let distanceMeters: Int
    let isSponsored: Bool

    static func festival(_ festival: Festival) -> DiscoverTabItem {
        let smartTags = festival.discoverTags

        return DiscoverTabItem(
            id: "festival-\(festival.id)",
            kind: .festival(festival),
            title: festival.title,
            subtitle: festival.subtitle ?? festival.venueName ?? festival.address,
            address: festival.address,
            dateText: "\(festival.startDate) - \(festival.endDate)",
            startDate: festival.startDate,
            endDate: festival.endDate,
            status: festival.status,
            domain: festival.discoverDomain,
            imageUrl: festival.primaryImageUrl,
            searchText: [
                festival.title,
                festival.subtitle,
                festival.venueName,
                festival.address,
                festival.source,
                DiscoverTabItem.regionSearchTerms(from: festival.address),
                smartTags.joined(separator: " ")
            ].compactMap { $0 }.joined(separator: " ").lowercased(),
            destination: festival.discoverDestination,
            presentation: festival.discoverPresentation,
            tags: smartTags,
            festivalCategory: festival.primaryCategory,
            eventCategory: nil,
            lat: festival.lat,
            lng: festival.lng,
            distanceMeters: festival.distanceMeters,
            isSponsored: false
        )
    }

    static func event(_ event: FreeEvent) -> DiscoverTabItem {
        let smartTags = event.discoverTags

        return DiscoverTabItem(
            id: "event-\(event.id)",
            kind: .event(event),
            title: event.title,
            subtitle: event.benefit ?? event.storeName,
            address: event.address,
            dateText: event.dateText,
            startDate: event.startDate,
            endDate: event.endDate ?? event.startDate,
            status: event.timelineStatus,
            domain: event.discoverDomain,
            imageUrl: event.primaryImageUrl,
            searchText: [
                event.title,
                event.eventType,
                event.storeName,
                event.address,
                event.source,
                event.benefit,
                event.shortDescription,
                DiscoverTabItem.regionSearchTerms(from: event.address),
                smartTags.joined(separator: " ")
            ].compactMap { $0 }.joined(separator: " ").lowercased(),
            destination: event.discoverDestination,
            presentation: event.discoverPresentation,
            tags: smartTags,
            festivalCategory: nil,
            eventCategory: event.primaryCategory,
            lat: event.lat,
            lng: event.lng,
            distanceMeters: event.distanceMeters,
            isSponsored: event.isSponsored
        )
    }

    func meters(from coordinate: CLLocationCoordinate2D?) -> Double {
        guard let coordinate else { return Double(distanceMeters) }
        let userLoc = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        let itemLoc = CLLocation(latitude: lat, longitude: lng)
        return userLoc.distance(from: itemLoc)
    }

    var typeText: String { domain.displayName }

    var isFestival: Bool {
        if case .festival = kind { return true }
        return false
    }

    var isEvent: Bool {
        if case .event = kind { return true }
        return false
    }

    /// 주소를 지역 검색어로 푼다. 주소가 "충청남도 천안시 …"여도 "충남"·"충남 천안"으로 찾을 수 있게
    /// 광역시도 단축명과 시/군/구(접미사 뺀 이름 포함)를 덧붙인다.
    private static func regionSearchTerms(from address: String) -> String? {
        let parsed = NotificationRegionKey.parse(address: address)
        guard let province = parsed.province else { return nil }
        guard let district = parsed.district else { return province }
        return "\(province) \(district) \(province) \(FestivalFilter.cityDisplayName(district))"
    }
}

/// 목록 분류는 지도 탭 레이어 토글과 같은 종류·이름·색을 쓴다. 한쪽만 바뀌면
/// 같은 데이터가 화면마다 다른 이름으로 보이므로 지도의 토글 구성을 그대로 따른다.
private enum DiscoverTabKind: String, CaseIterable, Identifiable {
    case all
    case festivals
    case localEvents
    case performances
    case tradeExpos

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "전체"
        case .festivals: return "축제"
        case .localEvents: return "가게 이벤트"
        case .performances: return "공연"
        case .tradeExpos: return "박람회"
        }
    }

    var systemImage: String {
        switch self {
        case .all: return "square.grid.2x2.fill"
        case .festivals: return "sparkles"
        case .localEvents: return "tag.fill"
        case .performances: return "music.note"
        case .tradeExpos: return FestivalPrimaryCategory.tradeExpo.systemImage
        }
    }

    var tint: Color {
        switch self {
        case .all: return FestivalDesign.coral
        case .festivals: return DiscoverDomain.festival.tint
        case .localEvents: return DiscoverDomain.localEvent.tint
        case .performances: return DiscoverDomain.performance.tint
        case .tradeExpos: return DiscoverDomain.tradeExpo.tint
        }
    }

    /// 카드에 붙는 종류 배지와 같은 기준으로 가른다. 예전에는 토글마다 조건을 따로 써서
    /// "공연" 배지가 붙은 항목이 축제 토글에도 나왔다.
    func includes(_ item: DiscoverTabItem) -> Bool {
        switch self {
        case .all: return true
        case .festivals: return item.domain == .festival
        case .localEvents: return item.domain == .localEvent
        case .performances: return item.domain == .performance
        case .tradeExpos: return item.domain == .tradeExpo
        }
    }
}

private enum DiscoverTabSort: String, CaseIterable, Identifiable {
    case distance
    case date
    case ongoing
    case name

    var id: String { rawValue }

    var title: String {
        switch self {
        case .distance: return "거리순"
        case .date: return "날짜순"
        case .ongoing: return "진행중 우선"
        case .name: return "이름순"
        }
    }

    func comparator(userLocation: CLLocationCoordinate2D?) -> (DiscoverTabItem, DiscoverTabItem) -> Bool {
        if case .distance = self {
            return { lhs, rhs in lhs.meters(from: userLocation) < rhs.meters(from: userLocation) }
        }
        return sort
    }

    func sort(_ lhs: DiscoverTabItem, _ rhs: DiscoverTabItem) -> Bool {
        switch self {
        case .distance:
            return lhs.distanceMeters < rhs.distanceMeters
        case .date:
            if lhs.startDate != rhs.startDate { return lhs.startDate < rhs.startDate }
            return lhs.title < rhs.title
        case .ongoing:
            if lhs.status != rhs.status { return lhs.status == .ongoing }
            if lhs.startDate != rhs.startDate { return lhs.startDate < rhs.startDate }
            return lhs.title < rhs.title
        case .name:
            return lhs.title < rhs.title
        }
    }
}

private struct DiscoverTabFilters: Equatable {
    /// 지도 탭 필터(`FestivalFilter`)와 같은 기간 선택지와 기본값을 쓴다.
    static let defaultDateRange: FestivalDateRange = .oneYear

    var dateRange: FestivalDateRange = Self.defaultDateRange
    var customFromDate: String?
    var customToDate: String?
    var selectedFestivalCategories: Set<FestivalPrimaryCategory> = []
    var selectedEventCategories: Set<LocalEventPrimaryCategory> = []
    /// `NotificationRegionKey` 형식("서울" / "서울|중구"). 비면 전 지역.
    var selectedRegions: [String] = []

    var hasFilters: Bool {
        count > 0
    }

    var count: Int {
        selectedFestivalCategories.count
            + selectedEventCategories.count
            + selectedRegions.count
            + (dateRange == Self.defaultDateRange ? 0 : 1)
    }

    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    /// 기간을 "yyyy-MM-dd" 구간으로 바꾼다. 항목마다 날짜를 계산하지 않도록 목록 한 번에 한 번만 부른다.
    /// 프리셋은 "오늘부터 N일 안에 시작"이고, 이미 진행 중인 행사는 시작일이 과거라 늘 통과한다.
    func dateBounds(now: Date = Date()) -> (from: String?, to: String?) {
        switch dateRange {
        case .ongoingOnly:
            return (nil, nil)
        case .custom:
            return (customFromDate, customToDate)
        default:
            let horizon = Calendar.current.date(byAdding: .day, value: dateRange.upcomingWithinDays, to: now) ?? now
            return (nil, Self.dayFormatter.string(from: horizon))
        }
    }

    func includes(_ item: DiscoverTabItem, bounds: (from: String?, to: String?)) -> Bool {
        if dateRange == .ongoingOnly, item.status != .ongoing { return false }
        // 이벤트 날짜에 시각이 붙어 와도 날짜끼리만 비교한다.
        if let to = bounds.to, String(item.startDate.prefix(10)) > to { return false }
        if let from = bounds.from, String(item.endDate.prefix(10)) < from { return false }
        if !NotificationRegionKey.matches(address: item.address, regions: selectedRegions) { return false }
        if item.isFestival, !selectedFestivalCategories.isEmpty {
            guard let category = item.festivalCategory, selectedFestivalCategories.contains(category) else {
                return false
            }
        }
        if item.isEvent, !selectedEventCategories.isEmpty {
            guard let category = item.eventCategory, selectedEventCategories.contains(category) else {
                return false
            }
        }
        return true
    }
}

private struct DiscoverTabFilterSheet: View {
    @Environment(\.dismiss) private var dismiss
    // 캘린더 필터와 동작을 맞춘다. 시트를 밀어 닫으면 변경이 버려지고, "적용"을 눌러야 반영된다.
    @Binding var applied: DiscoverTabFilters
    @State private var filters: DiscoverTabFilters
    let kind: DiscoverTabKind
    let festivalCategories: [FestivalPrimaryCategory]
    let eventCategories: [LocalEventPrimaryCategory]

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
        filters.customFromDate.flatMap { customDateFormatter.date(from: $0) } ?? today
    }

    private var toDate: Date {
        filters.customToDate.flatMap { customDateFormatter.date(from: $0) } ?? today
    }

    private func selectCustomFrom(_ date: Date) {
        filters.dateRange = .custom
        filters.customFromDate = customDateFormatter.string(from: date)
        if toDate < date {
            filters.customToDate = filters.customFromDate
        }
    }

    private func selectCustomTo(_ date: Date) {
        filters.dateRange = .custom
        filters.customToDate = customDateFormatter.string(from: date)
    }

    init(
        applied: Binding<DiscoverTabFilters>,
        kind: DiscoverTabKind,
        festivalCategories: [FestivalPrimaryCategory],
        eventCategories: [LocalEventPrimaryCategory]
    ) {
        _applied = applied
        _filters = State(initialValue: applied.wrappedValue)
        self.kind = kind
        self.festivalCategories = festivalCategories
        self.eventCategories = eventCategories
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    dateRangeSection
                    regionSection
                    if kind != .localEvents {
                        festivalCategorySection
                    }
                    if kind == .all || kind == .localEvents {
                        eventCategorySection
                    }
                }
                .padding(16)
            }
            .background(FestivalDesign.background.ignoresSafeArea())
            .festivalNavigationTitle("필터")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("초기화") {
                        filters = DiscoverTabFilters()
                    }
                    .foregroundStyle(FestivalDesign.coralText)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("적용") {
                        applied = filters
                        dismiss()
                    }
                    .fontWeight(.semibold)
                    .foregroundStyle(FestivalDesign.tealText)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    // 지도 탭 필터의 "조회 기간"과 같은 선택지·동작이다.
    private var dateRangeSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("조회 기간")
                .font(.festival(.headline))
                .foregroundStyle(FestivalDesign.navy)
            FlowLayout(spacing: 8) {
                ForEach(FestivalDateRange.allCases.filter { $0 != .custom }, id: \.self) { range in
                    filterChip(title: range.displayLabel, isSelected: filters.dateRange == range) {
                        filters.dateRange = range
                        filters.customFromDate = nil
                        filters.customToDate = nil
                    }
                }
                filterChip(title: FestivalDateRange.custom.displayLabel, isSelected: filters.dateRange == .custom) {
                    if filters.dateRange != .custom {
                        filters.dateRange = .custom
                        filters.customFromDate = customDateFormatter.string(from: today)
                        filters.customToDate = customDateFormatter.string(from: today)
                    }
                }
            }
            if filters.dateRange == .custom {
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
        .padding(14)
        .festivalCard()
    }

    // 행사 주소 기준. 서울 중구와 부산 중구를 가르도록 "광역시도|시군구" 키로 저장한다.
    private var regionSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("지역")
                    .font(.festival(.headline))
                    .foregroundStyle(FestivalDesign.navy)
                Spacer()
                if filters.selectedRegions.isEmpty {
                    Text("전체")
                        .font(.festival(.caption, weight: .semibold))
                        .foregroundStyle(FestivalDesign.secondaryText)
                } else {
                    StatusBadge(text: "\(filters.selectedRegions.count)", kind: .source)
                }
            }
            RegionAccordionPicker(selected: $filters.selectedRegions, qualified: true)
        }
        .padding(14)
        .festivalCard()
    }

    private var festivalCategorySection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("축제 카테고리")
                    .font(.festival(.headline))
                    .foregroundStyle(FestivalDesign.navy)
                Spacer()
                if !filters.selectedFestivalCategories.isEmpty {
                    StatusBadge(text: "\(filters.selectedFestivalCategories.count)", kind: .source)
                }
            }

            if festivalCategories.isEmpty {
                Text("선택할 항목이 없습니다")
                    .font(.festival(.subheadline))
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                FlowLayout(spacing: 8) {
                    ForEach(festivalCategories, id: \.self) { category in
                        categoryChip(
                            title: category.displayName,
                            systemImage: category.systemImage,
                            tint: category.tint,
                            isSelected: filters.selectedFestivalCategories.contains(category)
                        ) {
                            if filters.selectedFestivalCategories.contains(category) {
                                filters.selectedFestivalCategories.remove(category)
                            } else {
                                filters.selectedFestivalCategories.insert(category)
                            }
                        }
                    }
                }
            }
        }
        .padding(14)
        .festivalCard()
    }

    private var eventCategorySection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("이벤트 카테고리")
                    .font(.festival(.headline))
                    .foregroundStyle(FestivalDesign.navy)
                Spacer()
                if !filters.selectedEventCategories.isEmpty {
                    StatusBadge(text: "\(filters.selectedEventCategories.count)", kind: .source)
                }
            }

            if eventCategories.isEmpty {
                Text("선택할 항목이 없습니다")
                    .font(.festival(.subheadline))
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                FlowLayout(spacing: 8) {
                    ForEach(eventCategories, id: \.self) { category in
                        categoryChip(
                            title: category.displayName,
                            systemImage: category.systemImage,
                            tint: category.tint,
                            isSelected: filters.selectedEventCategories.contains(category)
                        ) {
                            if filters.selectedEventCategories.contains(category) {
                                filters.selectedEventCategories.remove(category)
                            } else {
                                filters.selectedEventCategories.insert(category)
                            }
                        }
                    }
                }
            }
        }
        .padding(14)
        .festivalCard()
    }

    private func categoryChip(
        title: String,
        systemImage: String,
        tint: Color,
        isSelected: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: systemImage)
                    .font(.festival(.caption2, weight: .bold))
                Text(title)
                    .font(.festival(.caption, weight: .semibold))
                    .lineLimit(1)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(isSelected ? tint.opacity(0.18) : FestivalDesign.cream.opacity(0.42))
            .foregroundStyle(isSelected ? FestivalDesign.readable(tint) : FestivalDesign.navy)
            .clipShape(FestivalDesign.controlShape)
            .overlay(
                FestivalDesign.controlShape
                    .stroke(isSelected ? tint.opacity(0.4) : FestivalDesign.creamDeep.opacity(0.48), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private func filterChip(title: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.festival(.caption, weight: .semibold))
                .lineLimit(1)
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(isSelected ? FestivalDesign.coral.opacity(0.16) : FestivalDesign.cream.opacity(0.42))
                .foregroundStyle(isSelected ? FestivalDesign.coralText : FestivalDesign.navy)
                .clipShape(FestivalDesign.controlShape)
                .overlay(
                    FestivalDesign.controlShape
                        .stroke(isSelected ? FestivalDesign.coral.opacity(0.28) : FestivalDesign.creamDeep.opacity(0.48), lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }
}

private struct DiscoverSegmentButtonStyle: ButtonStyle {
    let isSelected: Bool
    let tint: Color

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, 10)
            .padding(.vertical, 9)
            .background(isSelected ? tint.opacity(0.16) : FestivalDesign.surface)
            .foregroundStyle(isSelected ? FestivalDesign.readable(tint) : FestivalDesign.secondaryText)
            .clipShape(FestivalDesign.controlShape)
            .overlay(
                FestivalDesign.controlShape
                    .stroke(isSelected ? tint.opacity(0.32) : FestivalDesign.creamDeep.opacity(0.45), lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}

private struct DiscoverControlButtonStyle: ButtonStyle {
    let tint: Color
    let isActive: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(isActive ? tint.opacity(0.16) : FestivalDesign.cream.opacity(0.35))
            .foregroundStyle(isActive ? FestivalDesign.readable(tint) : FestivalDesign.navy)
            .clipShape(FestivalDesign.controlShape)
            .overlay(
                FestivalDesign.controlShape
                    .stroke(isActive ? tint.opacity(0.3) : FestivalDesign.creamDeep.opacity(0.45), lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}

private struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? 320
        let rows = rows(for: subviews, maxWidth: maxWidth)
        return CGSize(width: maxWidth, height: rows.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(width: size.width, height: size.height))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }

    private func rows(for subviews: Subviews, maxWidth: CGFloat) -> (height: CGFloat, width: CGFloat) {
        var x: CGFloat = 0
        var height: CGFloat = 0
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > maxWidth {
                height += rowHeight + spacing
                x = 0
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }

        height += rowHeight
        return (height, maxWidth)
    }
}

struct DiscoverTabRow: View {
    let item: DiscoverTabItem
    @EnvironmentObject private var festivalFavorites: FestivalFavoritesStore
    @EnvironmentObject private var eventFavorites: LocalEventFavoritesStore

    private var isFavorite: Bool {
        switch item.kind {
        case .festival(let festival): return festivalFavorites.contains(id: festival.id)
        case .event(let event): return eventFavorites.contains(id: event.id)
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            DiscoverTabThumbnail(imageUrl: item.imageUrl, isFestival: item.domain == .festival)

            VStack(alignment: .leading, spacing: 6) {
                // 태그 색은 DiscoverTagStyle 규칙을 따른다. 맨 앞만 분류 토글 색을 꽉 채우고 나머지는 옅게.
                HStack(spacing: DiscoverTagStyle.Size.regular.spacing) {
                    DiscoverTagChip(text: item.typeText, tint: item.domain.tint, isLead: true)
                    DiscoverTagChip(
                        text: item.status.displayText,
                        tint: item.status == .ended ? FestivalDesign.coral : item.domain.tint,
                        isLead: item.status == .ended
                    )
                    if item.isSponsored {
                        DiscoverTagChip(text: "스폰서", tint: item.domain.tint)
                    }
                }
                Text(item.title)
                    .font(.festival(.headline))
                    .foregroundStyle(FestivalDesign.navy)
                    .lineLimit(2)
                if item.subtitle != item.address {
                    Text(item.subtitle)
                        .font(.festival(.subheadline))
                        .foregroundStyle(FestivalDesign.secondaryText)
                        .lineLimit(2)
                }
                Text(item.dateText)
                    .font(.festival(.caption, weight: .semibold))
                    .foregroundStyle(FestivalDesign.tealText)
                Text(item.address)
                    .font(.festival(.caption))
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            VStack(spacing: 0) {
                Button {
                    switch item.kind {
                    case .festival(let festival): festivalFavorites.toggle(festival)
                    case .event(let event): eventFavorites.toggle(event)
                    }
                } label: {
                    Image(systemName: isFavorite ? "star.fill" : "star")
                        .font(.festival(size: 18, weight: .semibold))
                        .foregroundStyle(isFavorite ? FestivalDesign.lanternText : FestivalDesign.secondaryText)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(isFavorite ? "즐겨찾기 해제" : "즐겨찾기")

                DiscoverShareButton(
                    content: item.presentation.shareContent(destinationId: item.destination.id),
                    iconSize: 16,
                    tapSize: 40
                )
            }
        }
    }
}

struct DiscoverTabThumbnail: View {
    let imageUrl: String?
    let isFestival: Bool
    var size: CGFloat = 82

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    (isFestival ? FestivalDesign.coral : FestivalDesign.teal).opacity(0.15),
                    FestivalDesign.cream.opacity(0.48)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            if let imageUrl, let url = URL(string: imageUrl) {
                RemoteImage(url: url, downsamplePoints: size) {
                    Image("FestivalMascotIcon")
                        .resizable()
                        .scaledToFit()
                        .padding(14)
                }
            } else {
                Image("FestivalMascotIcon")
                    .resizable()
                    .scaledToFit()
                    .padding(14)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
    }
}

@MainActor
private final class UserLocationProvider: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var coordinate: CLLocationCoordinate2D?
    @Published var authorizationStatus: CLAuthorizationStatus = .notDetermined
    private let manager = CLLocationManager()

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        let status = manager.authorizationStatus
        authorizationStatus = status
        // 화면이 뜬 것만으로는 권한 팝업을 띄우지 않는다. 이미 허용된 경우에만 위치를 받는다.
        if status == .authorizedWhenInUse || status == .authorizedAlways {
            manager.requestLocation()
        }
    }

    /// 사용자가 "내 주변 순으로 보기"를 눌렀을 때만 부른다. 권한 팝업이 여기서만 뜬다.
    func request() {
        if manager.authorizationStatus == .notDetermined {
            manager.requestWhenInUseAuthorization()
        } else {
            manager.requestLocation()
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        Task { @MainActor in self.coordinate = loc.coordinate }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in self.authorizationStatus = status }
        if status == .authorizedWhenInUse || status == .authorizedAlways {
            Task { @MainActor in manager.requestLocation() }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        AppLogger.app.error("검색 화면 위치 수신 실패: \(error.localizedDescription, privacy: .public)")
    }
}

struct DestinationRow: View {
    let destination: Destination

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "mappin.circle.fill")
                .foregroundStyle(FestivalDesign.coralText)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 4) {
                Text(destination.name)
                    .font(.festival(.headline))
                    .foregroundStyle(FestivalDesign.navy)
                Text(destination.address)
                    .font(.festival(.subheadline))
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(2)
            }
            Spacer()
        }
    }
}
