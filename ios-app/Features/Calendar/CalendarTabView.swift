import SwiftUI
import UIKit

struct CalendarTabView: View {
    let apiClient: APIClientProtocol

    @EnvironmentObject private var router: Router
    @EnvironmentObject private var festivalSync: FestivalSyncService
    @StateObject private var viewModel: CalendarViewModel
    @StateObject private var filterModel: FestivalFilterModel
    @StateObject private var favoritesStore: FestivalFavoritesStore
    @StateObject private var reminderService = FestivalReminderService(appGroupID: AppConfiguration.current.appGroupID)
    @StateObject private var locationProvider = CurrentLocationProvider()

    @State private var monthAnchor: Date = Date()
    @State private var selectedDay: Date? = Date()
    @State private var weekendMode = false
    @State private var presentingFilter = false
    @State private var presentingSaved = false
    @State private var showNotificationDeniedAlert = false

    private let appGroupID: String
    private let calendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Seoul") ?? .current
        return cal
    }()

    init(apiClient: APIClientProtocol) {
        self.apiClient = apiClient
        let appGroupID = AppConfiguration.current.appGroupID
        self.appGroupID = appGroupID
        _viewModel = StateObject(wrappedValue: CalendarViewModel(apiClient: apiClient))
        _filterModel = StateObject(wrappedValue: FestivalFilterModel(scope: "calendar", appGroupID: appGroupID))
        _favoritesStore = StateObject(wrappedValue: FestivalFavoritesStore(appGroupID: appGroupID))
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            CalendarMonthView(
                monthAnchor: monthAnchor,
                festivalsByDay: viewModel.festivalsByDay,
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
            agendaSection
        }
        .background(FestivalDesign.background)
        .task {
            locationProvider.request()
            await reload()
            await reminderService.refreshScheduled()
        }
        .onChange(of: filterModel.filter) { _ in
            viewModel.reapply(filter: filterModel.filter)
            let coord = locationProvider.coordinate.map { (lat: $0.latitude, lng: $0.longitude) }
            festivalSync.sync(coordinate: coord)
        }
        .onChange(of: locationProvider.coordinate?.latitude) { _ in
            Task { await reload() }
            let coord = locationProvider.coordinate.map { (lat: $0.latitude, lng: $0.longitude) }
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
            }
            Spacer()
            VStack(spacing: 2) {
                Text(monthTitle)
                    .font(.festival(size: 17, weight: .bold))
                    .foregroundStyle(FestivalDesign.navy)
                if viewModel.state.isLoading {
                    Text("\u{BD88}\u{B7EC}\u{C624}\u{B294} \u{C911}\u{2026}")
                        .font(.festival(size: 10))
                        .foregroundStyle(FestivalDesign.secondaryText)
                } else {
                    Text("\(viewModel.allFestivals.count)\u{AC1C} \u{CD95}\u{C81C} \u{00B7} \u{D544}\u{D130} \(filterDescription)")
                        .font(.festival(size: 10))
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
            }
            Button {
                presentingSaved = true
            } label: {
                Image(systemName: favoritesStore.saved.isEmpty ? "bookmark" : "bookmark.fill")
                    .font(.festival(size: 14, weight: .bold))
                    .foregroundStyle(FestivalDesign.lantern)
                    .frame(width: 32, height: 32)
                    .background(FestivalDesign.cream.opacity(0.6))
                    .clipShape(Circle())
            }
            Button {
                presentingFilter = true
            } label: {
                Image(systemName: "slider.horizontal.3")
                    .font(.festival(size: 14, weight: .bold))
                    .foregroundStyle(FestivalDesign.coral)
                    .frame(width: 32, height: 32)
                    .background(FestivalDesign.cream.opacity(0.6))
                    .clipShape(Circle())
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(FestivalDesign.surface)
        .overlay(
            Rectangle()
                .fill(FestivalDesign.creamDeep.opacity(0.4))
                .frame(height: 1),
            alignment: .bottom
        )
    }

    private var legend: some View {
        HStack(spacing: 8) {
            Spacer()
            Button {
                weekendMode = false
                monthAnchor = Date()
                selectedDay = Date()
                haptic()
            } label: {
                presetLabel("\u{C624}\u{B298}") // 오늘
            }
            Button {
                jumpToWeekend()
            } label: {
                presetLabel("\u{C774}\u{BC88} \u{C8FC}\u{B9D0}", filled: weekendMode) // 이번 주말
            }
        }
        .padding(.horizontal, 16)
    }

    private func presetLabel(_ text: String, filled: Bool = false) -> some View {
        Text(text)
            .font(.festival(size: 12, weight: .semibold))
            .foregroundStyle(filled ? FestivalDesign.surface : FestivalDesign.coral)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(filled ? FestivalDesign.coral : FestivalDesign.cream.opacity(0.55))
            .clipShape(FestivalDesign.chipShape)
    }

    // MARK: - Agenda

    private var agendaSection: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(agendaTitle)
                    .font(.festival(size: 14, weight: .bold))
                    .foregroundStyle(FestivalDesign.navy)
                    .padding(.horizontal, 16)

                if case .failed(let message) = viewModel.state {
                    Text(message)
                        .font(.festival(size: 12))
                        .foregroundStyle(FestivalDesign.coral)
                        .padding(.horizontal, 16)
                } else if agendaFestivals.isEmpty {
                    emptyAgenda
                } else {
                    ForEach(agendaFestivals) { festival in
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
    }

    private var emptyAgenda: some View {
        VStack(spacing: 10) {
            Image(systemName: "calendar.badge.exclamationmark")
                .font(.festival(size: 30))
                .foregroundStyle(FestivalDesign.secondaryText)
            Text("\u{C774} \u{B0A0}\u{C740} \u{CD95}\u{C81C}\u{AC00} \u{C5C6}\u{C5B4}\u{C694}") // 이 날은 축제가 없어요
                .font(.festival(size: 14, weight: .semibold))
                .foregroundStyle(FestivalDesign.secondaryText)
            if viewModel.nextFestivalDay(onOrAfter: selectedDay ?? Date()) != nil {
                Button {
                    jumpToNextUpcoming()
                } label: {
                    Text("\u{B2E4}\u{C74C} \u{C608}\u{C815} \u{CD95}\u{C81C} \u{BCF4}\u{AE30}") // 다음 예정 축제 보기
                        .font(.festival(size: 13, weight: .bold))
                        .foregroundStyle(FestivalDesign.surface)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(FestivalDesign.coral)
                        .clipShape(FestivalDesign.chipShape)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 40)
    }

    // MARK: - Derived

    private var agendaFestivals: [Festival] {
        guard let day = selectedDay else { return [] }
        if weekendMode {
            var combined = viewModel.festivals(on: day)
            if let sunday = calendar.date(byAdding: .day, value: 1, to: day) {
                combined += viewModel.festivals(on: sunday)
            }
            var seen = Set<String>()
            return combined.filter { seen.insert($0.id).inserted }
        }
        return viewModel.festivals(on: day)
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

    private var agendaTitle: String {
        let count = agendaFestivals.count
        if weekendMode {
            return "\u{C774}\u{BC88} \u{C8FC}\u{B9D0} \u{00B7} \(count)\u{AC1C} \u{CD95}\u{C81C}" // 이번 주말 · N개 축제
        }
        let dayText = selectedDay.map { Self.agendaDayFormatter.string(from: $0) } ?? ""
        return "\(dayText) \u{00B7} \(count)\u{AC1C} \u{CD95}\u{C81C}" // M월 d일 (E) · N개 축제
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
        weekendMode = true
        monthAnchor = saturday
        selectedDay = calendar.startOfDay(for: saturday)
        haptic()
    }

    private func jumpToNextUpcoming() {
        guard let next = viewModel.nextFestivalDay(onOrAfter: selectedDay ?? Date()) else { return }
        weekendMode = false
        monthAnchor = next
        selectedDay = next
        haptic()
    }

    private func handleSelectDay(_ day: Date) {
        weekendMode = false
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
        let nowSaved = favoritesStore.toggle(festival)
        if !nowSaved {
            reminderService.cancel(id: festival.id)
        }
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

private struct AgendaRow: View {
    let festival: Festival
    let isSaved: Bool
    let isReminderOn: Bool
    let onSelect: () -> Void
    let onToggleSave: () -> Void
    let onToggleReminder: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            RoundedRectangle(cornerRadius: 6)
                .fill(festival.primaryCategory?.tint ?? statusColor)
                .frame(width: 4)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(festival.status.displayText)
                        .font(.festival(size: 10, weight: .bold))
                        .foregroundStyle(statusColor)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(statusColor.opacity(0.12))
                        .clipShape(FestivalDesign.chipShape)
                    Text(festival.startDate == festival.endDate ? festival.startDate : "\(festival.startDate) ~ \(festival.endDate)")
                        .font(.festival(size: 11, weight: .medium))
                        .foregroundStyle(FestivalDesign.secondaryText)
                }
                Text(festival.title)
                    .font(.festival(size: 15, weight: .bold))
                    .foregroundStyle(FestivalDesign.navy)
                    .multilineTextAlignment(.leading)
                if let venue = festival.venueName, !venue.isEmpty {
                    Text(venue)
                        .font(.festival(size: 12))
                        .foregroundStyle(FestivalDesign.secondaryText)
                }
                Text(festival.address)
                    .font(.festival(size: 11))
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            VStack(spacing: 10) {
                Button(action: onToggleSave) {
                    Image(systemName: isSaved ? "star.fill" : "star")
                        .font(.festival(size: 16, weight: .semibold))
                        .foregroundStyle(isSaved ? FestivalDesign.lantern : FestivalDesign.secondaryText)
                }
                .buttonStyle(.plain)
                if isSaved {
                    Button(action: onToggleReminder) {
                        Image(systemName: isReminderOn ? "bell.fill" : "bell")
                            .font(.festival(size: 15, weight: .semibold))
                            .foregroundStyle(isReminderOn ? FestivalDesign.coral : FestivalDesign.secondaryText)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(12)
        .festivalCard()
        .contentShape(Rectangle())
        .onTapGesture(perform: onSelect)
    }

    private var statusColor: Color {
        festival.status == .ongoing ? FestivalDesign.teal : FestivalDesign.lantern
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
                            Text("\u{CE98}\u{B9B0}\u{B354}\u{C5D0}\u{C11C} \u{BCC4}\u{D45C}\u{B97C} \u{D0ED}\u{D574} \u{CD95}\u{C81C}\u{B97C} \u{C800}\u{C7A5}\u{D574} \u{BCF4}\u{C138}\u{C694}.") // 캘린더에서 별표를 탭해 축제를 저장해 보세요.
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
                        .foregroundStyle(FestivalDesign.coral)
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
            VStack(spacing: 10) {
                Button {
                    onToggleReminder(saved)
                } label: {
                    Image(systemName: reminderService.isScheduled(id: saved.id) ? "bell.fill" : "bell")
                        .font(.festival(size: 15, weight: .semibold))
                        .foregroundStyle(reminderService.isScheduled(id: saved.id) ? FestivalDesign.coral : FestivalDesign.secondaryText)
                }
                .buttonStyle(.plain)
                Button {
                    reminderService.cancel(id: saved.id)
                    store.remove(id: saved.id)
                } label: {
                    Image(systemName: "trash")
                        .font(.festival(size: 14, weight: .semibold))
                        .foregroundStyle(FestivalDesign.secondaryText)
                }
                .buttonStyle(.plain)
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
