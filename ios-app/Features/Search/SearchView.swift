import CoreLocation
import SwiftUI

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
    @State private var errorMessage: String?
    @State private var selectedKind: DiscoverTabKind = .all
    @State private var sort: DiscoverTabSort = .distance
    @StateObject private var locationProvider = UserLocationProvider()
    @State private var filters = DiscoverTabFilters()
    @State private var showsFilters = false
    @State private var visibleItemCount = 20
    @State private var loadTask: Task<Void, Never>?
    @State private var cleanupTask: Task<Void, Never>?
    @State private var queryDebounceTask: Task<Void, Never>?
    @State private var allItems: [DiscoverTabItem] = []
    @State private var filteredItems: [DiscoverTabItem] = []
    @State private var availableSources: [String] = []
    @State private var availableFestivalCategories: [FestivalPrimaryCategory] = []
    @State private var availableEventCategories: [LocalEventPrimaryCategory] = []
    @State private var availableRegions: [String] = []
    @FocusState private var isSearchFocused: Bool

    private let koreaCenter = CLLocationCoordinate2D(latitude: 36.35, longitude: 127.80)
    private let discoverRadiusMeters = 460_000
    private let pageSize = 20
    private let cleanupDelayNanoseconds: UInt64 = 500_000_000
    private let queryDebounceNanoseconds: UInt64 = 250_000_000

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                discoverHeader
                searchCard
                discoverControls

                if isLoading {
                    LoadingStateView(text: "축제와 이벤트를 불러오는 중입니다")
                        .frame(height: 130)
                        .padding()
                        .festivalCard()
                }

                if let errorMessage {
                    FailureStateView(message: errorMessage) {
                        startDiscoverLoad(force: true)
                    }
                    .festivalCard()
                }

                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("축제 / 이벤트")
                            .font(.festival(.headline))
                            .foregroundStyle(FestivalDesign.navy)
                        Spacer()
                        StatusBadge(text: "\(filteredItems.count)개", kind: .source)
                    }

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
        }
        .scrollDismissesKeyboard(.interactively)
        .background(FestivalDesign.background.ignoresSafeArea())
        .festivalNavigationTitle("축제 / 이벤트")
        .onAppear {
            applyPendingDiscoverFilter()
            startDiscoverLoad()
        }
        .onDisappear {
            if tabRouter.selectedTab != .discover {
                scheduleDiscoverUnload()
            }
        }
        .onChange(of: tabRouter.selectedTab) { selectedTab in
            if selectedTab == .discover {
                applyPendingDiscoverFilter()
                startDiscoverLoad()
            } else {
                scheduleDiscoverUnload()
            }
        }
        .onChange(of: tabRouter.discoverFilterQuery) { _ in
            applyPendingDiscoverFilter()
        }
        .onChange(of: locationProvider.coordinate?.latitude) { _ in
            if sort == .distance { recomputeFilteredItems() }
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
                filters: $filters,
                kind: selectedKind,
                sources: availableSources,
                festivalCategories: availableFestivalCategories,
                eventCategories: availableEventCategories,
                regions: availableRegions
            )
        }
    }

    private func applyPendingDiscoverFilter() {
        guard let filter = tabRouter.discoverFilterQuery else { return }
        query = filter
        tabRouter.discoverFilterQuery = nil
    }

    private var discoverHeader: some View {
        HStack(spacing: 12) {
            Image("FestivalMascotGuide")
                .resizable()
                .scaledToFit()
                .frame(width: 64, height: 64)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text("지금 가볼 만한 축제")
                    .font(.festival(.headline))
                    .foregroundStyle(FestivalDesign.navy)
                Text("목록에서 장소를 고르면 근처 주차장을 바로 추천합니다.")
                    .font(.festival(.subheadline))
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(2)
            }
            Spacer()
        }
        .padding(14)
        .background(
            LinearGradient(
                colors: [FestivalDesign.cream.opacity(0.9), FestivalDesign.tealSoft],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
        .overlay(
            RoundedRectangle(cornerRadius: FestivalDesign.cardRadius)
                .stroke(FestivalDesign.creamDeep.opacity(0.45), lineWidth: 1)
        )
    }

    private var searchCard: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(FestivalDesign.teal)
            TextField(
                "",
                text: $query,
                prompt: Text("축제, 이벤트, 장소 검색")
                    .foregroundColor(FestivalDesign.secondaryText)
            )
            .focused($isSearchFocused)
            .textInputAutocapitalization(.never)
            .submitLabel(.search)

            if !query.isEmpty {
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(FestivalDesign.secondaryText)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(12)
        .festivalCard()
    }

    private var discoverControls: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                ForEach(DiscoverTabKind.allCases) { kind in
                    Button {
                        selectedKind = kind
                    } label: {
                        Label(kind.title, systemImage: kind.systemImage)
                            .font(.festival(.caption, weight: .bold))
                            .lineLimit(1)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(DiscoverSegmentButtonStyle(isSelected: selectedKind == kind, tint: kind.tint))
                }
            }

            HStack(spacing: 8) {
                Menu {
                    Picker("정렬", selection: $sort) {
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
        .padding(12)
        .festivalCard()
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
                            .foregroundStyle(FestivalDesign.coral)
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
        VStack(spacing: 12) {
            Image("FestivalMascotNight")
                .resizable()
                .scaledToFit()
                .frame(width: 132, height: 132)
                .accessibilityHidden(true)
            Text(query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "표시할 축제가 없습니다" : "검색 결과가 없습니다")
                .font(.festival(.headline))
                .foregroundStyle(FestivalDesign.navy)
            Text("검색어를 바꾸거나 잠시 후 다시 확인해 주세요.")
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
        let items = festivals.map(DiscoverTabItem.festival) + events.map(DiscoverTabItem.event)
        allItems = items
        availableSources = uniqueValues(items.map(\.source))
        availableFestivalCategories = FestivalPrimaryCategory.allCases.filter { category in
            items.contains { $0.festivalCategory == category }
        }
        availableEventCategories = LocalEventPrimaryCategory.allCases.filter { category in
            items.contains { $0.eventCategory == category }
        }
        availableRegions = uniqueValues(items.map(\.regionText))
        recomputeFilteredItems()
    }

    private func recomputeFilteredItems() {
        let trimmed = debouncedQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let searched = trimmed.isEmpty ? allItems : allItems.filter { $0.searchText.contains(trimmed) }
        let scoped = searched
            .filter { selectedKind.includes($0) }
            .filter { filters.includes($0) }

        if case .distance = sort, let coord = locationProvider.coordinate {
            // 거리순 정렬: 비교마다 CLLocation을 생성하면 O(n log n) 할당 → 미리 1회 계산
            let userLoc = CLLocation(latitude: coord.latitude, longitude: coord.longitude)
            filteredItems = scoped
                .map { ($0, CLLocation(latitude: $0.lat, longitude: $0.lng).distance(from: userLoc)) }
                .sorted { $0.1 < $1.1 }
                .map(\.0)
        } else {
            filteredItems = scoped.sorted(by: sort.comparator(userLocation: locationProvider.coordinate))
        }
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
        let statusLabels = Array(filters.selectedStatuses.map(\.displayText)).sorted()
        let festivalLabels = filters.selectedFestivalCategories.map(\.displayName).sorted()
        let eventLabels = filters.selectedEventCategories.map(\.displayName).sorted()
        return statusLabels
            + festivalLabels
            + eventLabels
            + filters.selectedRegions.sorted()
            + filters.selectedSources.sorted()
    }

    private func uniqueValues(_ values: [String]) -> [String] {
        Array(Set(values.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })).sorted()
    }

    private func startDiscoverLoad(force: Bool = false) {
        guard tabRouter.selectedTab == .discover else { return }
        cleanupTask?.cancel()
        cleanupTask = nil
        guard force || (festivals.isEmpty && events.isEmpty) else { return }
        loadTask?.cancel()
        loadTask = Task { @MainActor in
            await loadDiscoverItems()
        }
    }

    private func scheduleDiscoverUnload() {
        loadTask?.cancel()
        loadTask = nil
        cleanupTask?.cancel()
        cleanupTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: cleanupDelayNanoseconds)
            guard !Task.isCancelled, tabRouter.selectedTab != .discover else { return }
            festivals = []
            events = []
            errorMessage = nil
            isLoading = false
            resetVisibleItems()
            rebuildAllItems()
            cleanupTask = nil
        }
    }

    private func resetVisibleItems() {
        visibleItemCount = pageSize
    }

    private func loadMoreVisibleItems() {
        guard visibleItemCount < filteredItems.count else { return }
        visibleItemCount = min(visibleItemCount + pageSize, filteredItems.count)
    }

    private func loadDiscoverItems() async {
        isLoading = true
        errorMessage = nil
        do {
            async let festivalItems = apiClient.nearbyFestivals(
                lat: koreaCenter.latitude,
                lng: koreaCenter.longitude,
                radiusMeters: discoverRadiusMeters,
                upcomingWithinDays: 365
            )
            async let eventItems = apiClient.nearbyEvents(
                lat: koreaCenter.latitude,
                lng: koreaCenter.longitude,
                radiusMeters: discoverRadiusMeters
            )
            let loadedFestivals = try await festivalItems
            let loadedEvents = try await eventItems
            guard !Task.isCancelled, tabRouter.selectedTab == .discover else { return }
            festivals = loadedFestivals
            events = loadedEvents
            resetVisibleItems()
            rebuildAllItems()
        } catch {
            guard !Task.isCancelled else { return }
            errorMessage = "축제와 이벤트 정보를 불러오지 못했습니다."
        }
        guard !Task.isCancelled else { return }
        isLoading = false
    }
}

private struct DiscoverTabItem: Identifiable {
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
    let status: DiscoverStatus
    let typeText: String
    let source: String
    let imageUrl: String?
    let searchText: String
    let destination: Destination
    let presentation: DiscoverPresentation
    let tags: [String]
    let regionText: String
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
            status: festival.status,
            typeText: "축제",
            source: festival.source,
            imageUrl: festival.imageUrl,
            searchText: [
                festival.title,
                festival.subtitle,
                festival.venueName,
                festival.address,
                festival.source,
                smartTags.joined(separator: " ")
            ].compactMap { $0 }.joined(separator: " ").lowercased(),
            destination: festival.discoverDestination,
            presentation: DiscoverPresentation(
                title: festival.title,
                subtitle: festival.subtitle,
                description: festival.description ?? festival.subtitle,
                dateText: "\(festival.startDate) - \(festival.endDate)",
                venueName: festival.venueName,
                address: festival.address,
                status: festival.status,
                typeText: "축제",
                source: festival.source,
                sourceUrl: festival.sourceUrl,
                imageUrl: festival.imageUrl,
                imageUrls: festival.imageUrls,
                price: nil,
                region: nil,
                updatedAt: nil,
                tags: smartTags
            ),
            tags: smartTags,
            regionText: DiscoverTabItem.regionText(from: festival.address),
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
            status: event.timelineStatus,
            typeText: koreanEventType(event.eventType),
            source: event.source,
            imageUrl: event.imageUrl,
            searchText: [
                event.title,
                event.eventType,
                event.storeName,
                event.address,
                event.source,
                event.benefit,
                event.shortDescription,
                smartTags.joined(separator: " ")
            ].compactMap { $0 }.joined(separator: " ").lowercased(),
            destination: event.discoverDestination,
            presentation: DiscoverPresentation(
                title: event.title,
                subtitle: event.benefit ?? event.storeName,
                description: event.shortDescription,
                dateText: event.dateText,
                venueName: event.venueName ?? event.storeName,
                address: event.address,
                status: event.timelineStatus,
                typeText: koreanEventType(event.eventType),
                source: event.source,
                sourceUrl: event.sourceUrl,
                imageUrl: event.imageUrl,
                imageUrls: event.imageUrls,
                price: event.benefit,
                region: event.region,
                updatedAt: event.updatedAt,
                tags: smartTags
            ),
            tags: smartTags,
            regionText: DiscoverTabItem.regionText(from: event.address),
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

    var isFestival: Bool {
        if case .festival = kind { return true }
        return false
    }

    var isEvent: Bool {
        if case .event = kind { return true }
        return false
    }

    private static func regionText(from address: String) -> String {
        let token = address
            .split(whereSeparator: { $0.isWhitespace || $0 == "," })
            .map(String.init)
            .first ?? address
        if token.hasPrefix("서울") { return "서울" }
        if token.hasPrefix("부산") { return "부산" }
        if token.hasPrefix("대구") { return "대구" }
        if token.hasPrefix("인천") { return "인천" }
        if token.hasPrefix("광주") { return "광주" }
        if token.hasPrefix("대전") { return "대전" }
        if token.hasPrefix("울산") { return "울산" }
        if token.hasPrefix("세종") { return "세종" }
        if token.hasPrefix("경기") { return "경기" }
        if token.hasPrefix("강원") { return "강원" }
        if token.hasPrefix("충북") || token.hasPrefix("충청북") { return "충북" }
        if token.hasPrefix("충남") || token.hasPrefix("충청남") { return "충남" }
        if token.hasPrefix("전북") || token.hasPrefix("전라북") { return "전북" }
        if token.hasPrefix("전남") || token.hasPrefix("전라남") { return "전남" }
        if token.hasPrefix("경북") || token.hasPrefix("경상북") { return "경북" }
        if token.hasPrefix("경남") || token.hasPrefix("경상남") { return "경남" }
        if token.hasPrefix("제주") { return "제주" }
        return token
    }
}

private enum DiscoverTabKind: String, CaseIterable, Identifiable {
    case all
    case festivals
    case events

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "전체"
        case .festivals: return "축제"
        case .events: return "이벤트"
        }
    }

    var systemImage: String {
        switch self {
        case .all: return "square.grid.2x2.fill"
        case .festivals: return "sparkles"
        case .events: return "calendar"
        }
    }

    var tint: Color {
        switch self {
        case .all: return FestivalDesign.coral
        case .festivals: return FestivalDesign.coral
        case .events: return FestivalDesign.teal
        }
    }

    func includes(_ item: DiscoverTabItem) -> Bool {
        switch self {
        case .all: return true
        case .festivals: return item.isFestival
        case .events: return item.isEvent
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
    var selectedSources: Set<String> = []
    var selectedFestivalCategories: Set<FestivalPrimaryCategory> = []
    var selectedEventCategories: Set<LocalEventPrimaryCategory> = []
    var selectedStatuses: Set<DiscoverStatus> = []
    var selectedRegions: Set<String> = []

    var hasFilters: Bool {
        count > 0
    }

    var count: Int {
        selectedSources.count
            + selectedFestivalCategories.count
            + selectedEventCategories.count
            + selectedStatuses.count
            + selectedRegions.count
    }

    func includes(_ item: DiscoverTabItem) -> Bool {
        if !selectedSources.isEmpty && !selectedSources.contains(item.source) { return false }
        if !selectedStatuses.isEmpty && !selectedStatuses.contains(item.status) { return false }
        if !selectedRegions.isEmpty && !selectedRegions.contains(item.regionText) { return false }
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
    @Binding var filters: DiscoverTabFilters
    let kind: DiscoverTabKind
    let sources: [String]
    let festivalCategories: [FestivalPrimaryCategory]
    let eventCategories: [LocalEventPrimaryCategory]
    let regions: [String]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    filterHeader
                    statusSection
                    if kind != .events {
                        festivalCategorySection
                    }
                    if kind != .festivals {
                        eventCategorySection
                    }
                    filterSection(title: "지역", values: regions, selection: $filters.selectedRegions)
                    filterSection(title: "주관사/출처", values: sources, selection: $filters.selectedSources)
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
                    .foregroundStyle(FestivalDesign.coral)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("완료") {
                        dismiss()
                    }
                    .fontWeight(.semibold)
                    .foregroundStyle(FestivalDesign.teal)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var filterHeader: some View {
        HStack(spacing: 12) {
            Image("FestivalMascotIcon")
                .resizable()
                .scaledToFit()
                .frame(width: 58, height: 58)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text("보고 싶은 축제를 골라볼게요")
                    .font(.festival(.headline))
                    .foregroundStyle(FestivalDesign.navy)
                Text("장르, 지역, 진행 상태, 출처를 조합해서 목록을 좁힙니다.")
                    .font(.festival(.subheadline))
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(
            LinearGradient(
                colors: [FestivalDesign.cream.opacity(0.9), FestivalDesign.tealSoft],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
        .overlay(
            RoundedRectangle(cornerRadius: FestivalDesign.cardRadius)
                .stroke(FestivalDesign.creamDeep.opacity(0.45), lineWidth: 1)
        )
    }

    private var statusSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("상태")
                .font(.festival(.headline))
                .foregroundStyle(FestivalDesign.navy)
            FlowLayout(spacing: 8) {
                ForEach([DiscoverStatus.ongoing, .upcoming], id: \.self) { status in
                    filterChip(
                        title: status.displayText,
                        isSelected: filters.selectedStatuses.contains(status)
                    ) {
                        if filters.selectedStatuses.contains(status) {
                            filters.selectedStatuses.remove(status)
                        } else {
                            filters.selectedStatuses.insert(status)
                        }
                    }
                }
            }
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
            .foregroundStyle(isSelected ? tint : FestivalDesign.navy)
            .clipShape(FestivalDesign.controlShape)
            .overlay(
                FestivalDesign.controlShape
                    .stroke(isSelected ? tint.opacity(0.4) : FestivalDesign.creamDeep.opacity(0.48), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private func filterSection(title: String, values: [String], selection: Binding<Set<String>>, prefix: String = "") -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title)
                    .font(.festival(.headline))
                    .foregroundStyle(FestivalDesign.navy)
                Spacer()
                if !selection.wrappedValue.isEmpty {
                    StatusBadge(text: "\(selection.wrappedValue.count)", kind: .source)
                }
            }

            if values.isEmpty {
                Text("선택할 항목이 없습니다")
                    .font(.festival(.subheadline))
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                FlowLayout(spacing: 8) {
                    ForEach(values, id: \.self) { value in
                        filterChip(
                            title: "\(prefix)\(value)",
                            isSelected: selection.wrappedValue.contains(value)
                        ) {
                            toggle(value, in: selection)
                        }
                    }
                }
            }
        }
        .padding(14)
        .festivalCard()
    }

    private func filterChip(title: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.festival(.caption, weight: .semibold))
                .lineLimit(1)
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(isSelected ? FestivalDesign.coral.opacity(0.16) : FestivalDesign.cream.opacity(0.42))
                .foregroundStyle(isSelected ? FestivalDesign.coral : FestivalDesign.navy)
                .clipShape(FestivalDesign.controlShape)
                .overlay(
                    FestivalDesign.controlShape
                        .stroke(isSelected ? FestivalDesign.coral.opacity(0.28) : FestivalDesign.creamDeep.opacity(0.48), lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    private func toggle(_ value: String, in selection: Binding<Set<String>>) {
        if selection.wrappedValue.contains(value) {
            selection.wrappedValue.remove(value)
        } else {
            selection.wrappedValue.insert(value)
        }
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
            .foregroundStyle(isSelected ? tint : FestivalDesign.secondaryText)
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
            .foregroundStyle(isActive ? tint : FestivalDesign.navy)
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

private struct DiscoverTabRow: View {
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
            DiscoverTabThumbnail(imageUrl: item.imageUrl, isFestival: item.typeText == "축제")

            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    StatusBadge(text: item.typeText, kind: .source)
                    StatusBadge(text: item.status.displayText, kind: item.status == .ongoing ? .realtime : .neutral)
                    if item.isSponsored {
                        StatusBadge(text: "스폰서", kind: .sponsor)
                    }
                }
                Text(item.title)
                    .font(.festival(.headline))
                    .foregroundStyle(FestivalDesign.navy)
                    .lineLimit(2)
                Text(item.subtitle)
                    .font(.festival(.subheadline))
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(2)
                Text(item.dateText)
                    .font(.festival(.caption, weight: .semibold))
                    .foregroundStyle(FestivalDesign.teal)
                Text(item.address)
                    .font(.festival(.caption))
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            Button {
                switch item.kind {
                case .festival(let festival): festivalFavorites.toggle(festival)
                case .event(let event): eventFavorites.toggle(event)
                }
            } label: {
                Image(systemName: isFavorite ? "star.fill" : "star")
                    .font(.festival(size: 18, weight: .semibold))
                    .foregroundStyle(isFavorite ? FestivalDesign.lantern : FestivalDesign.secondaryText)
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
        }
    }
}

private struct DiscoverTabThumbnail: View {
    let imageUrl: String?
    let isFestival: Bool

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
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    default:
                        Image("FestivalMascotIcon")
                            .resizable()
                            .scaledToFit()
                            .padding(14)
                    }
                }
            } else {
                Image("FestivalMascotIcon")
                    .resizable()
                    .scaledToFit()
                    .padding(14)
            }
        }
        .frame(width: 82, height: 82)
        .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
    }
}

@MainActor
private final class UserLocationProvider: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var coordinate: CLLocationCoordinate2D?
    private let manager = CLLocationManager()

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        let status = manager.authorizationStatus
        if status == .authorizedWhenInUse || status == .authorizedAlways {
            manager.requestLocation()
        } else if status == .notDetermined {
            manager.requestWhenInUseAuthorization()
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        Task { @MainActor in self.coordinate = loc.coordinate }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        if status == .authorizedWhenInUse || status == .authorizedAlways {
            Task { @MainActor in manager.requestLocation() }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}
}

private func koreanEventType(_ raw: String) -> String {
    switch raw {
    case "discount": return "할인·세일"
    case "freebie": return "무료 증정"
    case "limited_menu", "new_limited": return "신메뉴·한정"
    case "popup": return "팝업·이벤트"
    case "opening", "opening_event": return "오픈 이벤트"
    case "review_event": return "리뷰 이벤트"
    case "seasonal": return "시즌·기념일"
    default: return "이벤트"
    }
}

struct DestinationRow: View {
    let destination: Destination

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "mappin.circle.fill")
                .foregroundStyle(FestivalDesign.coral)
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
