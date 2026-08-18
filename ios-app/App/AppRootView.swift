import SwiftUI
import UIKit

enum AppRoute: Hashable {
    case parkingResults(Destination, DiscoverPresentation?)
    case nearbyParkingMap(Destination, [ParkingRecommendation])
    case parkingDetail(Destination, ParkingLot)
    case navigation(Destination, ParkingLot)
}

enum AppTab: Hashable {
    case map
    case discover
    case favorites
    case calendar
    case settings

    var title: String {
        switch self {
        case .map: return "지도"
        case .discover: return "이벤트"
        case .favorites: return "즐겨찾기"
        case .calendar: return "캘린더"
        case .settings: return "설정"
        }
    }

    var systemImage: String {
        switch self {
        case .map: return "map.fill"
        case .discover: return "sparkles"
        case .favorites: return "star.fill"
        case .calendar: return "calendar"
        case .settings: return "gearshape.fill"
        }
    }

    static let visibleTabs: [AppTab] = [.map, .discover, .favorites, .calendar, .settings]
}

final class AppTabRouter: ObservableObject {
    @Published var selectedTab: AppTab = .map
    @Published var discoverFilterQuery: String?
}

struct AppRootView: View {
    let apiClient: APIClientProtocol
    @EnvironmentObject private var themeStore: FestivalThemeStore
    @EnvironmentObject private var festivalSync: FestivalSyncService
    @EnvironmentObject private var discoveryService: DiscoveryNotificationService
    @StateObject private var router = Router()
    @StateObject private var tabRouter = AppTabRouter()
    @StateObject private var festivalFilterModel = FestivalFilterModel(
        scope: "shared",
        appGroupID: AppConfiguration.current.appGroupID
    )
    @StateObject private var toastCenter = ToastCenter()
    @Environment(\.scenePhase) private var scenePhase

    init(apiClient: APIClientProtocol) {
        self.apiClient = apiClient
        Self.configureTabBarAppearance()
    }

    var body: some View {
        VStack(spacing: 0) {
            routedStack {
                switch tabRouter.selectedTab {
                case .map:
                    MapHomeView(apiClient: apiClient)
                case .discover:
                    SearchView(apiClient: apiClient)
                case .favorites:
                    FavoritesView()
                case .calendar:
                    CalendarTabView(apiClient: apiClient)
                case .settings:
                    SettingsView(apiClient: apiClient)
                }
            }
            .id(tabRouter.selectedTab)
            .animation(.easeInOut(duration: FestivalDesign.Motion.quick), value: tabRouter.selectedTab)
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            FestivalTabBar(selection: $tabRouter.selectedTab)
                .ignoresSafeArea(.container, edges: .bottom)
        }
        .paperGrainOverlay()
        .overlay(alignment: .top) {
            FestivalToastOverlay()
                .environmentObject(toastCenter)
        }
        .tint(FestivalDesign.coralText)
        // 팔레트는 자체 다크 변형을 쓰지만, 키보드·DatePicker 같은 시스템 컨트롤은 이 값으로만 따라온다.
        .preferredColorScheme(themeStore.isDarkMode ? .dark : .light)
        .environmentObject(tabRouter)
        .environmentObject(festivalFilterModel)
        .environmentObject(toastCenter)
        .onAppear {
            Self.configureTabBarAppearance()
        }
        .task {
            festivalSync.sync(coordinate: nil)
            discoveryService.scheduleNextRefresh()
        }
        .onChange(of: themeStore.selectedTheme) { _ in
            Self.configureTabBarAppearance()
        }
        .onChange(of: themeStore.isDarkMode) { _ in
            Self.configureTabBarAppearance()
        }
        .onChange(of: tabRouter.selectedTab) { _ in
            router.path.removeAll()
        }
        .onChange(of: scenePhase) { phase in
            if phase == .active {
                festivalSync.syncIfStale(coordinate: nil)
            } else if phase == .background {
                discoveryService.scheduleNextRefresh()
            }
        }
        .onReceive(DeepLinkRouter.shared.$pendingFestival) { festival in
            guard let festival else { return }
            DeepLinkRouter.shared.pendingFestival = nil
            openDiscover(festival)
        }
        .onReceive(DeepLinkRouter.shared.$pendingFestivalId) { id in
            guard let id else { return }
            DeepLinkRouter.shared.pendingFestivalId = nil
            // 위젯이 보여준 축제는 위젯 캐시에 그대로 있다. 못 찾으면 축제 탭까지만 열어 준다.
            let cached = SharedFestivalCache.load(appGroupID: AppConfiguration.current.appGroupID)?
                .items
                .first(where: { $0.id == id })
            if let cached {
                openDiscover(cached)
            } else {
                tabRouter.selectedTab = .discover
                router.path.removeAll()
            }
        }
    }

    private func openDiscover(_ festival: Festival) {
        tabRouter.selectedTab = .discover
        router.path.removeAll()
        router.showResults(for: festival.discoverDestination, presentation: festival.discoverPresentation)
    }

    private func routedStack<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        NavigationStack(path: $router.path) {
            content()
                .navigationDestination(for: AppRoute.self) { route in
                    routeDestination(for: route)
                }
        }
        .environmentObject(router)
    }

    @ViewBuilder
    private func routeDestination(for route: AppRoute) -> some View {
        switch route {
        case .parkingResults(let destination, let presentation):
            ParkingResultsView(destination: destination, apiClient: apiClient, presentation: presentation)
        case .nearbyParkingMap(let destination, let recommendations):
            NearbyParkingMapView(destination: destination, recommendations: recommendations)
        case .parkingDetail(let destination, let parkingLot):
            ParkingDetailView(destination: destination, parkingLot: parkingLot)
        case .navigation(let destination, let parkingLot):
            NavigationLaunchView(destination: destination, parkingLot: parkingLot)
        }
    }

    private static func configureTabBarAppearance() {
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(FestivalDesign.barSurface)
        appearance.shadowColor = UIColor(FestivalDesign.barBorder)

        let selectedColor = UIColor(FestivalDesign.coralText)
        let normalColor = UIColor(FestivalDesign.secondaryText)
        let selectedAttributes: [NSAttributedString.Key: Any] = [.foregroundColor: selectedColor]
        let normalAttributes: [NSAttributedString.Key: Any] = [.foregroundColor: normalColor]

        [appearance.stackedLayoutAppearance, appearance.inlineLayoutAppearance, appearance.compactInlineLayoutAppearance].forEach { item in
            item.selected.iconColor = selectedColor
            item.selected.titleTextAttributes = selectedAttributes
            item.normal.iconColor = normalColor
            item.normal.titleTextAttributes = normalAttributes
        }

        UITabBar.appearance().standardAppearance = appearance
        UITabBar.appearance().scrollEdgeAppearance = appearance
        configureNavigationBarAppearance()
    }

    private static func configureNavigationBarAppearance() {
        let appearance = UINavigationBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(FestivalDesign.barSurface)
        appearance.shadowColor = UIColor(FestivalDesign.barBorder)

        let titleColor = UIColor(FestivalDesign.coralText)
        appearance.titleTextAttributes = [
            .foregroundColor: titleColor,
            .font: FestivalDesign.uiFont(size: 17, weight: .bold)
        ]
        appearance.largeTitleTextAttributes = [
            .foregroundColor: titleColor,
            .font: FestivalDesign.uiFont(size: 34, weight: .bold)
        ]

        UINavigationBar.appearance().standardAppearance = appearance
        UINavigationBar.appearance().compactAppearance = appearance
        UINavigationBar.appearance().scrollEdgeAppearance = appearance
        UINavigationBar.appearance().tintColor = titleColor
    }
}

private struct FestivalTabBar: View {
    @Binding var selection: AppTab
    // 색을 static 경로에서 읽으므로, 테마가 바뀔 때 이 뷰가 다시 계산되도록 직접 구독한다.
    @EnvironmentObject private var themeStore: FestivalThemeStore

    var body: some View {
        HStack(spacing: 6) {
            ForEach(AppTab.visibleTabs, id: \.self) { tab in
                tabButton(tab)
            }
        }
        .padding(.horizontal, 8)
        .padding(.top, 4)
        .padding(.bottom, 0)
        .frame(maxWidth: .infinity)
        .background(
            FestivalDesign.barSurface
                .ignoresSafeArea(edges: .bottom)
        )
        .overlay(
            Rectangle()
                .fill(FestivalDesign.isHandDrawn
                    ? FestivalDesign.outline.opacity(0.75)
                    : FestivalDesign.barBorder)
                .frame(height: FestivalDesign.isHandDrawn ? 2 : 1),
            alignment: .top
        )
        .shadow(color: FestivalDesign.shadow(.medium).color, radius: 8, y: -2)
    }

    private func tabButton(_ tab: AppTab) -> some View {
        let isSelected = selection == tab

        return Button {
            selection = tab
        } label: {
            VStack(spacing: 4) {
                Image(systemName: tab.systemImage)
                    .font(.festival(size: 15, weight: .bold))
                    .foregroundStyle(isSelected ? FestivalDesign.coralText : FestivalDesign.secondaryText)
                Text(tab.title)
                    .font(.festival(size: 10, weight: isSelected ? .bold : .semibold))
                    .foregroundStyle(isSelected ? FestivalDesign.navy : FestivalDesign.secondaryText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.78)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 3)
            .padding(.bottom, 2)
            .background(isSelected ? FestivalDesign.cream.opacity(0.55) : Color.clear)
            .clipShape(FestivalDesign.controlShape)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tab.title)
    }
}

final class Router: ObservableObject {
    @Published var path: [AppRoute] = []

    func showResults(for destination: Destination, presentation: DiscoverPresentation? = nil) {
        path.append(.parkingResults(destination, presentation))
    }

    func showNearbyParkingMap(destination: Destination, recommendations: [ParkingRecommendation]) {
        path.append(.nearbyParkingMap(destination, recommendations))
    }

    func showDetail(destination: Destination, parkingLot: ParkingLot) {
        path.append(.parkingDetail(destination, parkingLot))
    }

    func startNavigation(destination: Destination, parkingLot: ParkingLot) {
        path.append(.navigation(destination, parkingLot))
    }
}
