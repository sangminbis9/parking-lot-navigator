import SwiftUI
import UIKit

struct CalendarTabView: View {
    let apiClient: APIClientProtocol

    @EnvironmentObject private var router: Router
    @EnvironmentObject private var festivalSync: FestivalSyncService
    @StateObject private var viewModel: CalendarViewModel
    @EnvironmentObject private var filterModel: FestivalFilterModel
    @EnvironmentObject private var favoritesStore: FestivalFavoritesStore
    @EnvironmentObject private var reminderService: FestivalReminderService
    @StateObject private var performanceViewModel: PerformanceViewModel
    @StateObject private var storeEventViewModel: StoreEventViewModel
    @StateObject private var locationProvider = CurrentLocationProvider()

    @State private var monthAnchor: Date = Date()
    @State private var selectedDay: Date? = Date()
    @State private var presentingFilter = false
    @State private var presentingSaved = false
    @State private var showNotificationDeniedAlert = false
    /// 달력 영역(헤더+월간+빠른 이동)의 실제 높이. 패널 기본 높이와 최대 확장량을 여기서 뽑는다.
    @State private var topBlockHeight: CGFloat = 380

    private let calendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Seoul") ?? .current
        return cal
    }()

    init(apiClient: APIClientProtocol) {
        self.apiClient = apiClient
        _viewModel = StateObject(wrappedValue: CalendarViewModel(apiClient: apiClient))
        _performanceViewModel = StateObject(wrappedValue: PerformanceViewModel(apiClient: apiClient))
        _storeEventViewModel = StateObject(wrappedValue: StoreEventViewModel(apiClient: apiClient))
    }

    var body: some View {
        let byDay = festivalsByDay
        let sections = daySections(from: byDay)
        // 하단 어젠다는 달력을 줄이지 않고 그 위로 덮으며 커진다. 달력 높이는 그대로 두고
        // 패널 높이만 드래그로 늘린다.
        GeometryReader { geo in
            let base = max(geo.size.height - topBlockHeight, 0)
            ZStack(alignment: .bottom) {
                VStack(spacing: 0) {
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
                        quickJumpRow
                            .padding(.vertical, 10)
                    }
                    .background(
                        GeometryReader { proxy in
                            Color.clear
                                .preference(key: CalendarTopHeightKey.self, value: proxy.size.height)
                        }
                    )
                    Spacer(minLength: 0)
                }
                AgendaPanel(
                    baseHeight: base,
                    maxExtraHeight: topBlockHeight,
                    filterButton: { self.filterButton }
                ) {
                    agendaScroll(sections: sections)
                }
            }
            .onPreferenceChange(CalendarTopHeightKey.self) { topBlockHeight = $0 }
        }
        .background(FestivalDesign.background)
        .task {
            locationProvider.request()
            await reload()
            let coord = locationProvider.coordinate.map { (lat: $0.latitude, lng: $0.longitude) }
            await performanceViewModel.load(coordinate: coord)
            await storeEventViewModel.load(coordinate: coord)
            await reminderService.refreshScheduled()
        }
        .onChange(of: filterModel.filter) { _ in
            Task { await viewModel.reapply(filter: filterModel.filter) }
            let coord = locationProvider.coordinate.map { (lat: $0.latitude, lng: $0.longitude) }
            festivalSync.sync(coordinate: coord)
        }
        .onChange(of: locationProvider.coordinate?.latitude) { _ in
            Task { await reload() }
            let coord = locationProvider.coordinate.map { (lat: $0.latitude, lng: $0.longitude) }
            Task { await storeEventViewModel.load(coordinate: coord) }
            festivalSync.sync(coordinate: coord)
        }
        .sheet(isPresented: $presentingFilter) {
            FilterSheetView(filterModel: filterModel)
        }
        .sheet(isPresented: $presentingSaved) {
            SavedFestivalsSheet(
                store: favoritesStore,
                reminderService: reminderService,
                onSelect: handleSelectSaved,
                onToggleReminder: toggleReminder
            )
            .presentationDetents([.medium, .large])
        }
        .alert("\u{C54C}\u{B9BC} \u{AD8C}\u{D55C}\u{C774} \u{A851}\u{C9C0} \u{C54A}\u{C558}\u{C5B4}\u{C694}", isPresented: $showNotificationDeniedAlert) {
            Button("\u{D655}\u{C778}", role: .cancel) {}
        } message: {
            Text("\u{C124}\u{C815} \u{2192} \u{C54C}\u{B9BC}\u{C5D0}\u{C11C} \u{C774}\u{BC88}\u{B2E4}\u{C758} \u{C54C}\u{B9BC}\u{C744} \u{D5C8}\u{C6A9}\u{D574} \u{C8FC}\u{C138}\u{C694}.") // 설정 → 알림에서 이벤트다의 알림을 허용해 주세요.
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 8) {
            Button {
                shiftMonth(by: -1)
            } label: {
                Image(systemName: "chevron.left")
                    .font(.festival(size: 14, weight: .bold))
                    .foregroundStyle(FestivalDesign.navy)
                    .frame(width: 32, height: 32)
                    .background(FestivalDesign.surface)
                    .clipShape(Circle())
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("\u{C774}\u{C804} \u{B2EC}") // 이전 달
            Spacer()
            VStack(spacing: 2) {
                Text(monthTitle)
                    .font(.festival(size: 17, weight: .bold))
                    .foregroundStyle(FestivalDesign.navy)
                if viewModel.state.isLoading {
                    Text("\u{BD88}\u{B7EC}\u{C624}\u{B294} \u{C911}\u{2026}")
                        .font(.festival(size: 11))
                        .foregroundStyle(FestivalDesign.secondaryText)
                } else {
                    Text("\u{D544}\u{D130} \(filterDescription)")
                        .font(.festival(size: 11))
                        .foregroundStyle(FestivalDesign.secondaryText)
                }
            }
            Spacer()
            Button {
                shiftMonth(by: 1)
            } label: {
                Image(systemName: "chevron.right")
                    .font(.festival(size: 14, weight: .bold))
                    .foregroundStyle(FestivalDesign.navy)
                    .frame(width: 32, height: 32)
                    .background(FestivalDesign.surface)
                    .clipShape(Circle())
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("\u{B2E4}\u{C74C} \u{B2EC}") // 다음 달
            Button {
                presentingSaved = true
            } label: {
                Image(systemName: favoritesStore.saved.isEmpty ? "bookmark" : "bookmark.fill")
                    .font(.festival(size: 14, weight: .bold))
                    .foregroundStyle(FestivalDesign.lanternText)
                    .frame(width: 32, height: 32)
                    .background(FestivalDesign.cream.opacity(0.6))
                    .clipShape(Circle())
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("\u{C800}\u{C7A5}\u{D55C} \u{CD95}\u{C81C}") // 저장한 축제
            filterButton
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(FestivalDesign.barSurface)
        .overlay(
            Rectangle()
                .fill(FestivalDesign.barBorder)
                .frame(height: 1),
            alignment: .bottom
        )
        .festivalShadow(.low)
    }

    /// 상단 헤더와 하단 어젠다 패널이 같은 필터 시트를 연다.
    private var filterButton: some View {
        Button {
            presentingFilter = true
        } label: {
            Image(systemName: "slider.horizontal.3")
                .font(.festival(size: 14, weight: .bold))
                .foregroundStyle(FestivalDesign.coralText)
                .frame(width: 32, height: 32)
                .background(FestivalDesign.cream.opacity(0.6))
                .clipShape(Circle())
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .accessibilityLabel("\u{D544}\u{D130}") // 필터
    }

    private var quickJumpRow: some View {
        HStack(spacing: 8) {
            Spacer()
            Button {
                let today = Date()
                monthAnchor = today
                selectedDay = calendar.startOfDay(for: today)
                haptic()
            } label: {
                presetLabel("\u{C624}\u{B298}") // 오늘
            }
            Button {
                jumpToWeekend()
            } label: {
                presetLabel("\u{C774}\u{BC88} \u{C8FC}\u{B9D0}") // 이번 주말
            }
        }
        .padding(.horizontal, 16)
    }

    private func presetLabel(_ text: String, filled: Bool = false) -> some View {
        Text(text)
            .font(.festival(size: 12, weight: .semibold))
            .foregroundStyle(filled ? FestivalDesign.onFill(FestivalDesign.coral) : FestivalDesign.coralText)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(filled ? FestivalDesign.coral : FestivalDesign.cream.opacity(0.55))
            .clipShape(FestivalDesign.chipShape)
    }

    // MARK: - Agenda

    /// 달 전체의 축제를 날짜 구획으로 이어서 보여준다. 날짜를 눌러야 목록이 생기는
    /// 예전 방식은 빈 날짜를 고르면 화면이 통째로 비어 무엇이 있는지 알 수 없었다.
    /// 이제 날짜 선택은 필터가 아니라 스크롤 이동이다.
    private func agendaScroll(sections: [DaySection]) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                    monthSummary(sections: sections)
                    if case .failed(let message) = viewModel.state {
                        Text(message)
                            .font(.festival(size: 12))
                            .foregroundStyle(FestivalDesign.coralText)
                            .padding(.horizontal, 16)
                            .padding(.bottom, 12)
                    } else if sections.isEmpty {
                        emptyAgenda
                    } else {
                        ForEach(sections) { section in
                            Section {
                                ForEach(section.festivals) { festival in
                                    AgendaRow(
                                        festival: festival,
                                        isSaved: favoritesStore.contains(id: festival.id),
                                        isReminderOn: reminderService.isScheduled(id: festival.id),
                                        onSelect: { handleSelectFestival(festival) },
                                        onToggleSave: { toggleSave(festival) },
                                        onToggleReminder: { toggleReminderForFestival(festival) }
                                    )
                                    .padding(.horizontal, 16)
                                    .padding(.bottom, 10)
                                }
                            } header: {
                                daySectionHeader(section)
                                    .id(section.id)
                            }
                        }
                    }
                    performanceSection
                    storeEventSection
                }
                .padding(.top, 14)
            }
            .onChange(of: selectedDay) { day in
                guard let target = scrollTarget(for: day, in: sections) else { return }
                withAnimation(.easeOut(duration: 0.25)) {
                    proxy.scrollTo(target, anchor: .top)
                }
            }
        }
    }

    private func monthSummary(sections: [DaySection]) -> some View {
        var ids = Set<String>()
        var savedCount = 0
        for section in sections {
            for festival in section.festivals where ids.insert(festival.id).inserted {
                if favoritesStore.contains(id: festival.id) { savedCount += 1 }
            }
        }
        return HStack(spacing: 6) {
            Text("\(monthTitle) \u{00B7} \u{CD95}\u{C81C} \(ids.count)\u{AC1C}") // yyyy년 M월 · 축제 N개
                .font(.festival(size: 14, weight: .bold))
                .foregroundStyle(FestivalDesign.navy)
            if savedCount > 0 {
                HStack(spacing: 3) {
                    Image(systemName: "star.fill")
                        .font(.festival(size: 9, weight: .bold))
                    Text("\(savedCount)")
                        .font(.festival(size: 11, weight: .bold))
                }
                .foregroundStyle(FestivalDesign.lanternText)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(FestivalDesign.lantern.opacity(0.16))
                .clipShape(FestivalDesign.chipShape)
            }
            Spacer()
            if viewModel.state.isLoading {
                ProgressView()
                    .controlSize(.small)
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
    }

    private func daySectionHeader(_ section: DaySection) -> some View {
        let isSelected = selectedDay.map { calendar.isDate($0, inSameDayAs: section.date) } ?? false
        let isToday = calendar.isDateInToday(section.date)
        return HStack(spacing: 6) {
            Text(Self.agendaDayFormatter.string(from: section.date))
                .font(.festival(size: 13, weight: .bold))
                .foregroundStyle(isSelected ? FestivalDesign.coralText : FestivalDesign.navy)
            if isToday {
                Text("\u{C624}\u{B298}") // 오늘
                    .font(.festival(size: 10, weight: .bold))
                    .foregroundStyle(FestivalDesign.onFill(FestivalDesign.coral))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(FestivalDesign.coral)
                    .clipShape(FestivalDesign.chipShape)
            }
            Text("\(section.festivals.count)")
                .font(.festival(size: 11, weight: .bold))
                .foregroundStyle(FestivalDesign.secondaryText)
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(FestivalDesign.background)
    }

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
                .padding(.top, 4)

            HStack(spacing: 6) {
                Image(systemName: "music.note")
                    .font(.festival(size: 12, weight: .bold))
                    .foregroundStyle(FestivalDesign.readable(FestivalPrimaryCategory.musicPerformance.tint))
                Text("\(selectedDayTitle) 근처 공연 · \(items.count)개")
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

    /// 축제·공연과 같은 날짜 기준으로 로컬 매장 이벤트도 함께 보여 준다.
    private var storeEventSection: some View {
        let dayFormatter = CalendarViewModel.dayFormatter
        let items: [FreeEvent] = {
            guard let day = selectedDay else { return [] }
            return storeEventViewModel.eventsForDay(day, formatter: dayFormatter)
        }()

        return VStack(alignment: .leading, spacing: 12) {
            Divider()
                .overlay(FestivalDesign.creamDeep.opacity(0.4))
                .padding(.horizontal, 16)
                .padding(.top, 4)

            HStack(spacing: 6) {
                Image(systemName: "bag.fill")
                    .font(.festival(size: 12, weight: .bold))
                    .foregroundStyle(FestivalDesign.readable(FestivalDesign.coral))
                Text("\(selectedDayTitle) 근처 가게 이벤트 · \(items.count)개")
                    .font(.festival(size: 14, weight: .bold))
                    .foregroundStyle(FestivalDesign.navy)
                Spacer()
                if storeEventViewModel.isLoading {
                    ProgressView()
                        .controlSize(.small)
                }
            }
            .padding(.horizontal, 16)

            if items.isEmpty && !storeEventViewModel.isLoading {
                Text("선택한 날짜에 근처 가게 이벤트가 없습니다")
                    .font(.festival(size: 12))
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .padding(.horizontal, 16)
            } else {
                ForEach(items) { event in
                    StoreEventRow(event: event) {
                        router.showResults(for: event.discoverDestination, presentation: event.discoverPresentation)
                    }
                    .padding(.horizontal, 16)
                }
            }
        }
        .padding(.bottom, 14)
    }

    private var emptyAgenda: some View {
        VStack(spacing: 10) {
            Image(systemName: "calendar.badge.exclamationmark")
                .font(.festival(size: 30))
                .foregroundStyle(FestivalDesign.secondaryText)
            Text("\u{C774} \u{B2EC}\u{C5D0}\u{B294} \u{C870}\u{AC74}\u{C5D0} \u{B9DE}\u{B294} \u{CD95}\u{C81C}\u{AC00} \u{C5C6}\u{C5B4}\u{C694}") // 이 달에는 조건에 맞는 축제가 없어요
                .font(.festival(size: 14, weight: .semibold))
                .foregroundStyle(FestivalDesign.secondaryText)
            Text("\u{BC18}\u{ACBD}\u{C774}\u{B098} \u{C870}\u{D68C} \u{AE30}\u{AC04}\u{C744} \u{B113}\u{D788}\u{AC70}\u{B098} \u{B2E4}\u{B978} \u{B2EC}\u{C744} \u{BCF4}\u{C138}\u{C694}") // 반경이나 조회 기간을 넓히거나 다른 달을 보세요
                .font(.festival(size: 12))
                .foregroundStyle(FestivalDesign.secondaryText)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button {
                presentingFilter = true
            } label: {
                presetLabel("\u{D544}\u{D130} \u{C5F4}\u{AE30}", filled: true) // 필터 열기
            }
            .padding(.top, 2)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 32)
        .padding(.bottom, 24)
    }

    // MARK: - Derived

    struct DaySection: Identifiable {
        let id: String
        let date: Date
        let festivals: [Festival]
    }

    /// 필터를 통과한 근처 축제 전체. 반경·기간 밖이라 목록에 없는 즐겨찾기는
    /// 캐시된 SavedFestival로 채워 넣어, 저장해 둔 축제가 달력에서 사라지지 않게 한다.
    private var festivalsByDay: [String: [Festival]] {
        var result = viewModel.festivalsByDay
        let loadedIDs = Set(viewModel.allFestivals.map(\.id))
        for saved in favoritesStore.saved where !loadedIDs.contains(saved.id) {
            bucket(saved.asFestival, into: &result)
        }
        return result
    }

    private func bucket(_ festival: Festival, into result: inout [String: [Festival]]) {
        guard let start = CalendarViewModel.dayFormatter.date(from: festival.startDate) else { return }
        let end = CalendarViewModel.dayFormatter.date(from: festival.endDate) ?? start
        var cursor = start
        var safety = 0
        while cursor <= end, safety < 200 {
            result[CalendarViewModel.dayFormatter.string(from: cursor), default: []].append(festival)
            guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
            cursor = next
            safety += 1
        }
    }

    /// 보고 있는 달에서 축제가 있는 날만 구획으로 만든다. 이번 달을 볼 때는
    /// 이미 지난 날짜를 건너뛴다.
    private func daySections(from byDay: [String: [Festival]]) -> [DaySection] {
        guard let interval = calendar.dateInterval(of: .month, for: monthAnchor) else { return [] }
        let isCurrentMonth = calendar.isDate(monthAnchor, equalTo: Date(), toGranularity: .month)
        var cursor = isCurrentMonth ? max(interval.start, calendar.startOfDay(for: Date())) : interval.start
        var sections: [DaySection] = []
        while cursor < interval.end {
            let key = CalendarViewModel.dayFormatter.string(from: cursor)
            if let items = byDay[key], !items.isEmpty {
                sections.append(DaySection(id: key, date: cursor, festivals: sortedForAgenda(items)))
            }
            guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
            cursor = next
        }
        return sections
    }

    /// 즐겨찾기를 맨 위로 올리고, 그다음은 가까운 순.
    private func sortedForAgenda(_ items: [Festival]) -> [Festival] {
        items.sorted { lhs, rhs in
            let lhsSaved = favoritesStore.contains(id: lhs.id)
            let rhsSaved = favoritesStore.contains(id: rhs.id)
            if lhsSaved != rhsSaved { return lhsSaved }
            if lhs.distanceMeters != rhs.distanceMeters { return lhs.distanceMeters < rhs.distanceMeters }
            return lhs.title < rhs.title
        }
    }

    /// 고른 날에 축제가 없으면 그 뒤로 가장 가까운 날의 구획으로 보낸다.
    private func scrollTarget(for day: Date?, in sections: [DaySection]) -> String? {
        guard let day else { return nil }
        let key = CalendarViewModel.dayFormatter.string(from: day)
        return sections.first { $0.id >= key }?.id ?? sections.last?.id
    }

    private static let monthTitleFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.dateFormat = "yyyy\u{B144} M\u{C6D4}"
        return formatter
    }()

    private static let agendaDayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.dateFormat = "M\u{C6D4} d\u{C77C} (E)"
        return formatter
    }()

    private var selectedDayTitle: String {
        selectedDay.map { Self.agendaDayFormatter.string(from: $0) } ?? ""
    }

    private var savedDayKeys: Set<String> {
        var keys = Set<String>()
        for fav in favoritesStore.saved {
            guard let start = CalendarViewModel.dayFormatter.date(from: fav.startDate) else { continue }
            let end = CalendarViewModel.dayFormatter.date(from: fav.endDate) ?? start
            var cursor = start
            var safety = 0
            while cursor <= end, safety < 200 {
                keys.insert(CalendarViewModel.dayFormatter.string(from: cursor))
                guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
                cursor = next
                safety += 1
            }
        }
        return keys
    }

    private var monthTitle: String {
        Self.monthTitleFormatter.string(from: monthAnchor)
    }

    private var filterDescription: String {
        let f = filterModel.filter
        var parts: [String] = []
        if let radius = f.radiusKm {
            parts.append("\(radius)km")
        } else {
            parts.append("\u{C804}\u{AD6D}") // 전국
        }
        if !f.regions.isEmpty {
            parts.append("\(f.regions.count)\u{AC1C} \u{C9C0}\u{C5ED}") // N개 지역
        }
        if !f.primaryCategories.isEmpty {
            parts.append("\u{CE74}\u{D14C}\u{ACE0}\u{B9AC} \(f.primaryCategories.count)") // 카테고리 N
        }
        return parts.joined(separator: " \u{00B7} ")
    }

    // MARK: - Actions

    private func shiftMonth(by delta: Int) {
        if let next = calendar.date(byAdding: .month, value: delta, to: monthAnchor) {
            monthAnchor = next
            haptic()
        }
    }

    private func jumpToWeekend() {
        let today = Date()
        // 다음(또는 오늘) 토요일 찾기. weekday: 일=1 … 토=7
        let weekday = calendar.component(.weekday, from: today)
        let offset = (7 - weekday) % 7 // 토요일까지 남은 일수
        guard let saturday = calendar.date(byAdding: .day, value: offset, to: today) else { return }
        monthAnchor = saturday
        selectedDay = calendar.startOfDay(for: saturday)
        haptic()
    }

    private func handleSelectDay(_ day: Date) {
        selectedDay = day
        haptic()
    }

    private func handleSelectFestival(_ festival: Festival) {
        router.showResults(for: festival.discoverDestination, presentation: festival.discoverPresentation)
    }

    private func handleSelectSaved(_ saved: SavedFestival) {
        presentingSaved = false
        router.showResults(for: saved.destination, presentation: saved.presentation)
    }

    private func toggleSave(_ festival: Festival) {
        favoritesStore.toggle(festival)
        haptic()
    }

    private func toggleReminderForFestival(_ festival: Festival) {
        toggleReminder(SavedFestival(festival: festival))
    }

    private func toggleReminder(_ saved: SavedFestival) {
        if reminderService.isScheduled(id: saved.id) {
            reminderService.cancel(id: saved.id)
            return
        }
        Task {
            let ok = await reminderService.schedule(for: saved)
            if !ok {
                let granted = await reminderService.requestAuthorizationIfNeeded()
                if !granted { showNotificationDeniedAlert = true }
            }
        }
    }

    private func haptic() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    private func reload() async {
        let coord = locationProvider.coordinate.map { (lat: $0.latitude, lng: $0.longitude) }
        await viewModel.load(coordinate: coord, filter: filterModel.filter)
    }
}

// MARK: - Agenda Row

/// 하단 어젠다 패널. 드래그 상태를 이 뷰가 직접 들고 있어야 손가락을 따라가는 동안
/// 달력 전체 body가 다시 계산되지 않는다(재계산하면 그날 목록을 매 프레임 다시 만들어 버벅인다).
private struct AgendaPanel<Filter: View, Content: View>: View {
    let baseHeight: CGFloat
    let maxExtraHeight: CGFloat
    let filterButton: Filter
    let content: Content

    /// 드래그로 얼마나 더 끌어올렸는지(pt). 0이면 달력 바로 아래에서 시작한다.
    @State private var extraHeight: CGFloat = 0
    @GestureState private var dragTranslation: CGFloat = 0

    init(
        baseHeight: CGFloat,
        maxExtraHeight: CGFloat,
        @ViewBuilder filterButton: () -> Filter,
        @ViewBuilder content: () -> Content
    ) {
        self.baseHeight = baseHeight
        self.maxExtraHeight = maxExtraHeight
        self.filterButton = filterButton()
        self.content = content()
    }

    var body: some View {
        let extra = min(max(extraHeight - dragTranslation, 0), maxExtraHeight)
        VStack(spacing: 0) {
            handle
            Divider()
                .overlay(FestivalDesign.creamDeep.opacity(0.4))
            content
        }
        .frame(height: baseHeight + extra, alignment: .top)
        .background(FestivalDesign.background)
        .overlay(
            Rectangle()
                .fill(FestivalDesign.barBorder)
                .frame(height: 1),
            alignment: .top
        )
    }

    /// 패널 상단의 드래그 손잡이. 드래그 영역은 필터 버튼 아래에 깔아 탭을 가로채지 않는다.
    private var handle: some View {
        ZStack {
            Color.clear
                .contentShape(Rectangle())
                .gesture(dragGesture)
            Capsule()
                .fill(FestivalDesign.creamDeep)
                .frame(width: 40, height: 4)
                .allowsHitTesting(false)
            HStack(spacing: 0) {
                Spacer()
                filterButton
            }
        }
        .frame(height: 40)
        .padding(.horizontal, 12)
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 1)
            .updating($dragTranslation) { value, state, _ in
                state = value.translation.height
            }
            .onEnded { value in
                extraHeight = min(max(extraHeight - value.translation.height, 0), maxExtraHeight)
            }
    }
}

private struct AgendaRow: View {
    let festival: Festival
    let isSaved: Bool
    let isReminderOn: Bool
    let onSelect: () -> Void
    let onToggleSave: () -> Void
    let onToggleReminder: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            DiscoverTabThumbnail(imageUrl: festival.primaryImageUrl, isFestival: true, size: 68)
                .overlay(alignment: .topLeading) {
                    if isSaved {
                        Image(systemName: "star.fill")
                            .font(.festival(size: 9, weight: .bold))
                            .foregroundStyle(FestivalDesign.onFill(FestivalDesign.lantern))
                            .padding(4)
                            .background(FestivalDesign.lantern)
                            .clipShape(Circle())
                            .padding(4)
                    }
                }
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 5) {
                    StatusBadge(
                        text: festival.status.displayText,
                        kind: festival.status.badgeKind
                    )
                    if let category = festival.primaryCategory {
                        // 태그 색은 카테고리별 색이 아니라 이벤트 탭 토글과 같은 종류 색을 따라간다.
                        let tint = festival.discoverDomain.tint
                        Text(category.displayName)
                            .font(.festival(size: 10, weight: .semibold))
                            .foregroundStyle(FestivalDesign.readable(tint))
                            .padding(.horizontal, 7)
                            .padding(.vertical, 3)
                            .background(tint.opacity(0.16))
                            .clipShape(FestivalDesign.chipShape)
                    }
                }
                Text(festival.title)
                    .font(.festival(size: 15, weight: .bold))
                    .foregroundStyle(FestivalDesign.navy)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Text(periodAndFee)
                    .font(.festival(size: 12, weight: .medium))
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(1)
                if !placeLine.isEmpty {
                    Text(placeLine)
                        .font(.festival(size: 12))
                        .foregroundStyle(FestivalDesign.secondaryText)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            VStack(spacing: 2) {
                Button(action: onToggleSave) {
                    Image(systemName: isSaved ? "star.fill" : "star")
                        .font(.festival(size: 16, weight: .semibold))
                        .foregroundStyle(isSaved ? FestivalDesign.lanternText : FestivalDesign.secondaryText)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(isSaved ? "\u{C990}\u{ACA8}\u{CC3E}\u{AE30} \u{D574}\u{C81C}" : "\u{C990}\u{ACA8}\u{CC3E}\u{AE30}") // 즐겨찾기 해제 / 즐겨찾기
                if isSaved {
                    Button(action: onToggleReminder) {
                        Image(systemName: isReminderOn ? "bell.fill" : "bell")
                            .font(.festival(size: 15, weight: .semibold))
                            .foregroundStyle(isReminderOn ? FestivalDesign.coralText : FestivalDesign.secondaryText)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(isReminderOn ? "\u{C54C}\u{B9BC} \u{B044}\u{AE30}" : "\u{C54C}\u{B9BC} \u{CF1C}\u{AE30}") // 알림 끄기 / 알림 켜기
                }
                DiscoverShareButton(content: festival.shareContent, iconSize: 15, tapSize: 40)
            }
        }
        .padding(12)
        .festivalCard()
        .contentShape(Rectangle())
        .onTapGesture(perform: onSelect)
    }

    /// 기간과 요금은 한 줄에 붙인다. 요금 정보가 없으면 기간만 남긴다.
    private var periodAndFee: String {
        var parts = [periodText]
        if let fee = festival.admissionFee?.trimmingCharacters(in: .whitespacesAndNewlines), !fee.isEmpty {
            parts.append(fee)
        }
        return parts.joined(separator: " \u{00B7} ")
    }

    private var periodText: String {
        let start = Self.shortDate(festival.startDate)
        let end = Self.shortDate(festival.endDate)
        return start == end ? start : "\(start) ~ \(end)"
    }

    private var placeLine: String {
        var parts: [String] = []
        let venue = festival.venueName?.trimmingCharacters(in: .whitespaces) ?? ""
        parts.append(venue.isEmpty ? festival.address : venue)
        if festival.distanceMeters > 0 {
            parts.append(Self.distanceText(festival.distanceMeters))
        }
        return parts.filter { !$0.isEmpty }.joined(separator: " \u{00B7} ")
    }

    /// "2026-08-14" → "8.14". 날짜 구획 안에서는 연도가 군더더기다.
    private static func shortDate(_ raw: String) -> String {
        let parts = raw.split(separator: "-")
        guard parts.count == 3, let month = Int(parts[1]), let day = Int(parts[2]) else { return raw }
        return "\(month).\(day)"
    }

    private static func distanceText(_ meters: Int) -> String {
        meters < 1000 ? "\(meters)m" : String(format: "%.1fkm", Double(meters) / 1000)
    }
}

// MARK: - Performance Row

private struct PerformanceRow: View {
    let item: PerformanceItem
    let onSelect: () -> Void

    var body: some View {
        let p = item.presentation
        HStack(alignment: .top, spacing: 12) {
            RoundedRectangle(cornerRadius: 6)
                .fill(DiscoverDomain.performance.tint)
                .frame(width: 4)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(p.status.displayText)
                        .font(.festival(size: 10, weight: .bold))
                        .foregroundStyle(p.status.chipText)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(p.status.chipFill)
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
            DiscoverShareButton(
                content: p.shareContent(destinationId: item.discoverDestination.id),
                iconSize: 15,
                tapSize: 40
            )
        }
        .padding(12)
        .festivalCard()
        .contentShape(Rectangle())
        .onTapGesture(perform: onSelect)
    }
}

private struct StoreEventRow: View {
    let event: FreeEvent
    let onSelect: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            RoundedRectangle(cornerRadius: 6)
                .fill(DiscoverDomain.localEvent.tint)
                .frame(width: 4)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(event.timelineStatus.displayText)
                        .font(.festival(size: 10, weight: .bold))
                        .foregroundStyle(event.timelineStatus.chipText)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(event.timelineStatus.chipFill)
                        .clipShape(FestivalDesign.chipShape)
                    Text(event.dateText)
                        .font(.festival(size: 11, weight: .medium))
                        .foregroundStyle(FestivalDesign.secondaryText)
                }
                Text(event.title)
                    .font(.festival(size: 15, weight: .bold))
                    .foregroundStyle(FestivalDesign.navy)
                    .multilineTextAlignment(.leading)
                if let benefit = event.benefit, !benefit.isEmpty {
                    Text(benefit)
                        .font(.festival(size: 12))
                        .foregroundStyle(FestivalDesign.secondaryText)
                }
                Text(event.storeName)
                    .font(.festival(size: 11))
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            DiscoverShareButton(
                content: event.shareContent,
                iconSize: 15,
                tapSize: 40
            )
        }
        .padding(12)
        .festivalCard()
        .contentShape(Rectangle())
        .onTapGesture(perform: onSelect)
    }
}

// MARK: - Saved Festivals Sheet

private struct SavedFestivalsSheet: View {
    @ObservedObject var store: FestivalFavoritesStore
    @ObservedObject var reminderService: FestivalReminderService
    let onSelect: (SavedFestival) -> Void
    let onToggleReminder: (SavedFestival) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 12) {
                    if store.saved.isEmpty {
                        VStack(spacing: 8) {
                            Image(systemName: "bookmark")
                                .font(.festival(size: 32))
                                .foregroundStyle(FestivalDesign.secondaryText)
                            Text("\u{C800}\u{C7A5}\u{D55C} \u{CD95}\u{C81C}\u{AC00} \u{C5C6}\u{C5B4}\u{C694}") // 저장한 축제가 없어요
                                .font(.festival(size: 14, weight: .semibold))
                                .foregroundStyle(FestivalDesign.secondaryText)
                            Text("\u{C774}\u{BCA4}\u{D2B8} \u{D0ED}\u{C5D0}\u{C11C} \u{2606} \u{C744} \u{D0ED}\u{D574} \u{AD00}\u{C2EC} \u{CD95}\u{C81C}\u{B97C} \u{CD94}\u{AC00}\u{D574} \u{BCF4}\u{C138}\u{C694}") // 이벤트 탭에서 ☆ 을 탭해 관심 축제를 추가해 보세요
                                .font(.festival(size: 12))
                                .foregroundStyle(FestivalDesign.secondaryText)
                                .multilineTextAlignment(.center)
                        }
                        .padding(.top, 60)
                    } else {
                        ForEach(store.saved.sorted { $0.startDate < $1.startDate }) { saved in
                            savedRow(saved)
                        }
                    }
                }
                .padding(16)
            }
            .background(FestivalDesign.background)
            .navigationTitle("\u{C800}\u{C7A5}\u{D55C} \u{CD95}\u{C81C}") // 저장한 축제
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("\u{B2EB}\u{AE30}") { dismiss() } // 닫기
                        .foregroundStyle(FestivalDesign.coralText)
                }
            }
        }
    }

    private func savedRow(_ saved: SavedFestival) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(saved.startDate == saved.endDate ? saved.startDate : "\(saved.startDate) ~ \(saved.endDate)")
                    .font(.festival(size: 11, weight: .medium))
                    .foregroundStyle(FestivalDesign.secondaryText)
                Text(saved.title)
                    .font(.festival(size: 15, weight: .bold))
                    .foregroundStyle(FestivalDesign.navy)
                    .multilineTextAlignment(.leading)
                if let venue = saved.venueName, !venue.isEmpty {
                    Text(venue)
                        .font(.festival(size: 12))
                        .foregroundStyle(FestivalDesign.secondaryText)
                }
            }
            Spacer(minLength: 0)
            VStack(spacing: 2) {
                Button {
                    onToggleReminder(saved)
                } label: {
                    Image(systemName: reminderService.isScheduled(id: saved.id) ? "bell.fill" : "bell")
                        .font(.festival(size: 15, weight: .semibold))
                        .foregroundStyle(reminderService.isScheduled(id: saved.id) ? FestivalDesign.coralText : FestivalDesign.secondaryText)
                        .frame(width: 40, height: 40)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(reminderService.isScheduled(id: saved.id) ? "\u{C54C}\u{B9BC} \u{B044}\u{AE30}" : "\u{C54C}\u{B9BC} \u{CF1C}\u{AE30}") // 알림 끄기 / 알림 켜기
                Button {
                    reminderService.cancel(id: saved.id)
                    store.remove(id: saved.id)
                } label: {
                    Image(systemName: "trash")
                        .font(.festival(size: 14, weight: .semibold))
                        .foregroundStyle(FestivalDesign.secondaryText)
                        .frame(width: 40, height: 40)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\u{C800}\u{C7A5} \u{D574}\u{C81C}") // 저장 해제
                DiscoverShareButton(
                    content: saved.presentation.shareContent(destinationId: saved.destination.id),
                    iconSize: 15,
                    tapSize: 40
                )
            }
        }
        .padding(12)
        .festivalCard()
        .contentShape(Rectangle())
        .onTapGesture { onSelect(saved) }
    }
}

private extension CalendarViewModel.LoadState {
    var isLoading: Bool {
        if case .loading = self { return true }
        return false
    }
}

/// 달력 영역의 실제 높이를 하단 어젠다 패널에 전달한다.
private struct CalendarTopHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}
