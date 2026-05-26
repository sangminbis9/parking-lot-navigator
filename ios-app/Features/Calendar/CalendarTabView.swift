import SwiftUI

struct CalendarTabView: View {
    let apiClient: APIClientProtocol

    @EnvironmentObject private var router: Router
    @EnvironmentObject private var festivalSync: FestivalSyncService
    @StateObject private var viewModel: CalendarViewModel
    @StateObject private var filterModel: FestivalFilterModel
    @StateObject private var locationProvider = CurrentLocationProvider()

    @State private var monthAnchor: Date = Date()
    @State private var selectedDay: Date?
    @State private var presentingFilter = false
    @State private var showDaySheet = false

    private let appGroupID: String
    private let calendar = Calendar(identifier: .gregorian)

    init(apiClient: APIClientProtocol) {
        self.apiClient = apiClient
        let appGroupID = AppConfiguration.current.appGroupID
        self.appGroupID = appGroupID
        _viewModel = StateObject(wrappedValue: CalendarViewModel(apiClient: apiClient))
        _filterModel = StateObject(wrappedValue: FestivalFilterModel(scope: "calendar", appGroupID: appGroupID))
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                VStack(spacing: 16) {
                    CalendarMonthView(
                        monthAnchor: monthAnchor,
                        festivalsByDay: viewModel.festivalsByDay,
                        selectedDay: selectedDay,
                        onSelectDay: handleSelectDay
                    )
                    legend
                    if case .failed(let message) = viewModel.state {
                        Text(message)
                            .font(.system(size: 12))
                            .foregroundStyle(FestivalDesign.coral)
                    }
                }
                .padding(.vertical, 12)
            }
        }
        .background(FestivalDesign.background)
        .task {
            locationProvider.request()
            await reload()
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
        .sheet(isPresented: $showDaySheet) {
            if let day = selectedDay {
                CalendarDayDetailSheet(
                    date: day,
                    festivals: viewModel.festivals(on: day),
                    onSelectFestival: handleSelectFestival
                )
                .presentationDetents([.medium, .large])
            }
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Button {
                shiftMonth(by: -1)
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(FestivalDesign.navy)
                    .frame(width: 32, height: 32)
                    .background(FestivalDesign.surface)
                    .clipShape(Circle())
            }
            Spacer()
            VStack(spacing: 2) {
                Text(monthTitle)
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(FestivalDesign.navy)
                if viewModel.state.isLoading {
                    Text("불러오는 중…")
                        .font(.system(size: 10))
                        .foregroundStyle(FestivalDesign.secondaryText)
                } else {
                    Text("\(viewModel.allFestivals.count)개 축제 · 필터 \(filterDescription)")
                        .font(.system(size: 10))
                        .foregroundStyle(FestivalDesign.secondaryText)
                }
            }
            Spacer()
            Button {
                shiftMonth(by: 1)
            } label: {
                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(FestivalDesign.navy)
                    .frame(width: 32, height: 32)
                    .background(FestivalDesign.surface)
                    .clipShape(Circle())
            }
            Button {
                presentingFilter = true
            } label: {
                Image(systemName: "slider.horizontal.3")
                    .font(.system(size: 14, weight: .bold))
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
        HStack(spacing: 14) {
            legendItem(color: FestivalDesign.teal, label: "진행 중")
            legendItem(color: FestivalDesign.lantern, label: "예정")
            Spacer()
            Button {
                monthAnchor = Date()
                selectedDay = Date()
            } label: {
                Text("오늘")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(FestivalDesign.coral)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(FestivalDesign.cream.opacity(0.55))
                    .clipShape(Capsule())
            }
        }
        .padding(.horizontal, 16)
    }

    private func legendItem(color: Color, label: String) -> some View {
        HStack(spacing: 5) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(label)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(FestivalDesign.secondaryText)
        }
    }

    private var monthTitle: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.dateFormat = "yyyy년 M월"
        return formatter.string(from: monthAnchor)
    }

    private var filterDescription: String {
        let f = filterModel.filter
        var parts: [String] = []
        if let radius = f.radiusKm {
            parts.append("\(radius)km")
        } else {
            parts.append("전국")
        }
        if !f.regions.isEmpty {
            parts.append("\(f.regions.count)개 지역")
        }
        if !f.primaryCategories.isEmpty {
            parts.append("카테고리 \(f.primaryCategories.count)")
        }
        return parts.joined(separator: " · ")
    }

    private func shiftMonth(by delta: Int) {
        if let next = calendar.date(byAdding: .month, value: delta, to: monthAnchor) {
            monthAnchor = next
        }
    }

    private func handleSelectDay(_ day: Date) {
        selectedDay = day
        let festivals = viewModel.festivals(on: day)
        if !festivals.isEmpty {
            showDaySheet = true
        }
    }

    private func handleSelectFestival(_ festival: Festival) {
        router.showResults(for: festival.discoverDestination, presentation: festival.discoverPresentation)
    }

    private func reload() async {
        let coord = locationProvider.coordinate.map { (lat: $0.latitude, lng: $0.longitude) }
        await viewModel.load(coordinate: coord, filter: filterModel.filter)
    }
}

private extension CalendarViewModel.LoadState {
    var isLoading: Bool {
        if case .loading = self { return true }
        return false
    }
}
