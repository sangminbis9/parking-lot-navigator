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
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var selectedKind: DiscoverTabKind = .all
    @State private var sort: DiscoverTabSort = .date
    @State private var filters = DiscoverTabFilters()
    @State private var showsFilters = false
    @State private var visibleItemCount = 20
    @State private var loadTask: Task<Void, Never>?
    @FocusState private var isSearchFocused: Bool

    private let koreaCenter = CLLocationCoordinate2D(latitude: 36.35, longitude: 127.80)
    private let discoverRadiusMeters = 460_000
    private let pageSize = 20

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
                        Text("축제와 이벤트")
                            .font(.headline)
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
        .navigationTitle("축제")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            applyPendingDiscoverFilter()
            startDiscoverLoad()
        }
        .onDisappear {
            if tabRouter.selectedTab != .discover {
                unloadDiscoverItems()
            }
        }
        .onChange(of: tabRouter.selectedTab) { selectedTab in
            if selectedTab == .discover {
                applyPendingDiscoverFilter()
                startDiscoverLoad()
            } else {
                unloadDiscoverItems()
            }
        }
        .onChange(of: tabRouter.discoverFilterQuery) { _ in
            applyPendingDiscoverFilter()
        }
        .onChange(of: query) { _ in
            resetVisibleItems()
        }
        .onChange(of: selectedKind) { _ in
            resetVisibleItems()
        }
        .onChange(of: sort) { _ in
            resetVisibleItems()
        }
        .onChange(of: filters) { _ in
            resetVisibleItems()
        }
        .sheet(isPresented: $showsFilters) {
            DiscoverTabFilterSheet(
                filters: $filters,
                sources: availableSources,
                tags: availableTags,
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
                    .font(.headline)
                    .foregroundStyle(FestivalDesign.navy)
                Text("목록에서 장소를 고르면 근처 주차장을 바로 추천합니다.")
                    .font(.subheadline)
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
                            .font(.caption.weight(.bold))
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
                        .font(.caption.weight(.semibold))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(DiscoverControlButtonStyle(tint: FestivalDesign.teal, isActive: false))

                Button {
                    showsFilters = true
                } label: {
                    Label(filters.hasFilters ? "필터 \(filters.count)" : "필터", systemImage: filters.hasFilters ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                        .font(.caption.weight(.semibold))
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
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(FestivalDesign.coral)
                            .padding(.horizontal, 9)
                            .padding(.vertical, 5)
                            .background(FestivalDesign.cream.opacity(0.55))
                            .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.controlRadius))
                    }
                    Button {
                        filters = DiscoverTabFilters()
                    } label: {
                        Label("초기화", systemImage: "xmark.circle.fill")
                            .font(.caption.weight(.semibold))
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
                .font(.headline)
                .foregroundStyle(FestivalDesign.navy)
            Text("검색어를 바꾸거나 잠시 후 다시 확인해 주세요.")
                .font(.subheadline)
                .foregroundStyle(FestivalDesign.secondaryText)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 30)
        .festivalCard()
    }

    private var allItems: [DiscoverTabItem] {
        festivals.map(DiscoverTabItem.festival) + events.map(DiscoverTabItem.event)
    }

    private var filteredItems: [DiscoverTabItem] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let searched = trimmed.isEmpty ? allItems : allItems.filter { $0.searchText.contains(trimmed) }
        let scoped = searched
            .filter { selectedKind.includes($0) }
            .filter { filters.includes($0) }
        return scoped.sorted(by: sort.sort)
    }

    private var visibleItems: [DiscoverTabItem] {
        Array(filteredItems.prefix(visibleItemCount))
    }

    private var availableSources: [String] {
        uniqueValues(allItems.map(\.source))
    }

    private var availableTags: [String] {
        uniqueValues(allItems.flatMap(\.tags))
    }

    private var availableRegions: [String] {
        uniqueValues(allItems.map(\.regionText))
    }

    private var activeFilterLabels: [String] {
        Array(filters.selectedStatuses.map(\.displayText)).sorted()
            + filters.selectedTags.sorted().map { "#\($0)" }
            + filters.selectedRegions.sorted()
            + filters.selectedSources.sorted()
    }

    private func uniqueValues(_ values: [String]) -> [String] {
        Array(Set(values.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })).sorted()
    }

    private func startDiscoverLoad(force: Bool = false) {
        guard tabRouter.selectedTab == .discover else { return }
        guard force || (festivals.isEmpty && events.isEmpty) else { return }
        loadTask?.cancel()
        loadTask = Task { @MainActor in
            await loadDiscoverItems()
        }
    }

    private func unloadDiscoverItems() {
        loadTask?.cancel()
        loadTask = nil
        festivals = []
        events = []
        errorMessage = nil
        isLoading = false
        resetVisibleItems()
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
                radiusMeters: discoverRadiusMeters
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

    static func festival(_ festival: Festival) -> DiscoverTabItem {
        let smartTags = DiscoverTagBuilder.festivalTags(
            title: festival.title,
            subtitle: festival.subtitle,
            venueName: festival.venueName,
            address: festival.address,
            startDate: festival.startDate,
            source: festival.source,
            rawTags: festival.tags
        )

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
            destination: Destination(
                id: "festival-\(festival.id)",
                name: festival.title,
                address: festival.address,
                lat: festival.lat,
                lng: festival.lng,
                source: festival.source,
                rawCategory: smartTags.joined(separator: ","),
                normalizedCategory: "festival"
            ),
            presentation: DiscoverPresentation(
                title: festival.title,
                subtitle: festival.subtitle,
                dateText: "\(festival.startDate) - \(festival.endDate)",
                venueName: festival.venueName,
                address: festival.address,
                status: festival.status,
                typeText: "축제",
                source: festival.source,
                imageUrl: festival.imageUrl,
                tags: smartTags
            ),
            tags: smartTags,
            regionText: DiscoverTabItem.regionText(from: festival.address)
        )
    }

    static func event(_ event: FreeEvent) -> DiscoverTabItem {
        let smartTags = DiscoverTagBuilder.eventTags(
            title: event.title,
            eventType: event.eventType,
            description: event.shortDescription,
            venueName: event.venueName,
            address: event.address,
            startDate: event.startDate,
            source: event.source
        )

        return DiscoverTabItem(
            id: "event-\(event.id)",
            kind: .event(event),
            title: event.title,
            subtitle: event.shortDescription ?? event.venueName ?? event.address,
            address: event.address,
            dateText: "\(event.startDate) - \(event.endDate)",
            startDate: event.startDate,
            status: event.status,
            typeText: event.eventType.isEmpty ? "이벤트" : event.eventType,
            source: event.source,
            imageUrl: event.imageUrl,
            searchText: [
                event.title,
                event.eventType,
                event.venueName,
                event.address,
                event.source,
                event.shortDescription,
                smartTags.joined(separator: " ")
            ].compactMap { $0 }.joined(separator: " ").lowercased(),
            destination: Destination(
                id: "event-\(event.id)",
                name: event.title,
                address: event.address,
                lat: event.lat,
                lng: event.lng,
                source: event.source,
                rawCategory: smartTags.joined(separator: ","),
                normalizedCategory: "event"
            ),
            presentation: DiscoverPresentation(
                title: event.title,
                subtitle: event.shortDescription,
                dateText: "\(event.startDate) - \(event.endDate)",
                venueName: event.venueName,
                address: event.address,
                status: event.status,
                typeText: event.eventType.isEmpty ? "이벤트" : event.eventType,
                source: event.source,
                imageUrl: event.imageUrl,
                tags: smartTags
            ),
            tags: smartTags,
            regionText: DiscoverTabItem.regionText(from: event.address)
        )
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
    case date
    case ongoing
    case name

    var id: String { rawValue }

    var title: String {
        switch self {
        case .date: return "날짜순"
        case .ongoing: return "진행중 우선"
        case .name: return "이름순"
        }
    }

    func sort(_ lhs: DiscoverTabItem, _ rhs: DiscoverTabItem) -> Bool {
        switch self {
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
    var selectedTags: Set<String> = []
    var selectedStatuses: Set<DiscoverStatus> = []
    var selectedRegions: Set<String> = []

    var hasFilters: Bool {
        count > 0
    }

    var count: Int {
        selectedSources.count + selectedTags.count + selectedStatuses.count + selectedRegions.count
    }

    func includes(_ item: DiscoverTabItem) -> Bool {
        if !selectedSources.isEmpty && !selectedSources.contains(item.source) { return false }
        if !selectedTags.isEmpty && Set(item.tags).isDisjoint(with: selectedTags) { return false }
        if !selectedStatuses.isEmpty && !selectedStatuses.contains(item.status) { return false }
        if !selectedRegions.isEmpty && !selectedRegions.contains(item.regionText) { return false }
        return true
    }
}

private struct DiscoverTabFilterSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var filters: DiscoverTabFilters
    let sources: [String]
    let tags: [String]
    let regions: [String]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    filterHeader
                    statusSection
                    filterSection(title: "장르/태그", values: tags, selection: $filters.selectedTags, prefix: "#")
                    filterSection(title: "지역", values: regions, selection: $filters.selectedRegions)
                    filterSection(title: "주관사/출처", values: sources, selection: $filters.selectedSources)
                }
                .padding(16)
            }
            .background(FestivalDesign.background.ignoresSafeArea())
            .navigationTitle("필터")
            .navigationBarTitleDisplayMode(.inline)
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
                    .font(.headline)
                    .foregroundStyle(FestivalDesign.navy)
                Text("장르, 지역, 진행 상태, 출처를 조합해서 목록을 좁힙니다.")
                    .font(.subheadline)
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
                .font(.headline)
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

    private func filterSection(title: String, values: [String], selection: Binding<Set<String>>, prefix: String = "") -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title)
                    .font(.headline)
                    .foregroundStyle(FestivalDesign.navy)
                Spacer()
                if !selection.wrappedValue.isEmpty {
                    StatusBadge(text: "\(selection.wrappedValue.count)", kind: .source)
                }
            }

            if values.isEmpty {
                Text("선택할 항목이 없습니다")
                    .font(.subheadline)
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
                .font(.caption.weight(.semibold))
                .lineLimit(1)
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(isSelected ? FestivalDesign.coral.opacity(0.16) : FestivalDesign.cream.opacity(0.42))
                .foregroundStyle(isSelected ? FestivalDesign.coral : FestivalDesign.navy)
                .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.controlRadius))
                .overlay(
                    RoundedRectangle(cornerRadius: FestivalDesign.controlRadius)
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
            .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.controlRadius))
            .overlay(
                RoundedRectangle(cornerRadius: FestivalDesign.controlRadius)
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
            .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.controlRadius))
            .overlay(
                RoundedRectangle(cornerRadius: FestivalDesign.controlRadius)
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

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            DiscoverTabThumbnail(imageUrl: item.imageUrl, isFestival: item.typeText == "축제")

            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    StatusBadge(text: item.typeText, kind: .source)
                    StatusBadge(text: item.status.displayText, kind: item.status == .ongoing ? .realtime : .neutral)
                }
                Text(item.title)
                    .font(.headline)
                    .foregroundStyle(FestivalDesign.navy)
                    .lineLimit(2)
                Text(item.subtitle)
                    .font(.subheadline)
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(2)
                Text(item.dateText)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(FestivalDesign.teal)
                Text(item.address)
                    .font(.caption)
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
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

struct DestinationRow: View {
    let destination: Destination

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "mappin.circle.fill")
                .foregroundStyle(FestivalDesign.coral)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 4) {
                Text(destination.name)
                    .font(.headline)
                    .foregroundStyle(FestivalDesign.navy)
                Text(destination.address)
                    .font(.subheadline)
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(2)
            }
            Spacer()
        }
    }
}
