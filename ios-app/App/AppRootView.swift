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
    @StateObject private var routers = TabRouters()
    @StateObject private var tabRouter = AppTabRouter()
    // 아직 한 번도 열지 않은 탭은 만들지 않는다. 앱 실행 직후 다섯 탭이 동시에 로딩되면 안 된다.
    @State private var visitedTabs: Set<AppTab> = [.map]
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
            ZStack {
                // 탭은 처음 열 때 한 번만 만들고 이후에는 숨긴 채 살려 둔다. 탭을 오갔다고
                // 화면 스택·지도 위치·불러온 목록이 사라지면 안 되기 때문이다.
                ForEach(AppTab.visibleTabs, id: \.self) { tab in
                    if visitedTabs.contains(tab) {
                        TabNavigationStack(
                            router: routers.router(for: tab),
                            tab: tab,
                            apiClient: apiClient
                        )
                        .opacity(tab == tabRouter.selectedTab ? 1 : 0)
                        .allowsHitTesting(tab == tabRouter.selectedTab)
                        .accessibilityHidden(tab != tabRouter.selectedTab)
                        .zIndex(tab == tabRouter.selectedTab ? 1 : 0)
                    }
                }
            }
            // 탭 전체에 cross-fade를 걸면 전환하는 동안 지도 UIView와 다른 탭이 동시에 합성된다.
            // 지도 엔진이 붙어 있는 화면에서는 그 한 프레임이 그대로 입력 지연으로 온다.
            // 전환 애니메이션은 탭바 버튼 쪽에만 남긴다.
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            FestivalTabBar(
                selection: $tabRouter.selectedTab,
                // 이미 보고 있는 탭을 다시 누르면 그 탭의 화면 스택만 처음으로 되감는다.
                // 탭을 새로 만들지 않으므로 지도 위치·불러온 목록은 그대로 남는다.
                onReselect: { routers.router(for: $0).path.removeAll() }
            )
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
            // 콜드 스타트에는 지도 탐색 API가 먼저다. 위젯 캐시가 아직 신선하면 이번 실행에서는 건드리지 않는다.
            festivalSync.syncIfStale(coordinate: nil, minimumInterval: 1_800)
            discoveryService.scheduleNextRefresh()
        }
        .onChange(of: themeStore.selectedTheme) { _ in
            Self.configureTabBarAppearance()
        }
        .onChange(of: themeStore.isDarkMode) { _ in
            Self.configureTabBarAppearance()
        }
        .onChange(of: tabRouter.selectedTab) { tab in
            visitedTabs.insert(tab)
        }
        // 필터가 바뀌면 위젯이 보고 있는 캐시도 같은 기준으로 다시 채운다.
        .onChange(of: festivalFilterModel.filter) { _ in
            festivalSync.sync(coordinate: nil)
        }
        .onChange(of: scenePhase) { phase in
            if phase == .active {
                festivalSync.syncIfStale(coordinate: nil)
            } else if phase == .background {
                discoveryService.scheduleNextRefresh()
            }
        }
        .onReceive(DeepLinkRouter.shared.$pendingCalendarAt) { at in
            guard at != nil else { return }
            DeepLinkRouter.shared.pendingCalendarAt = nil
            openTab(.calendar).path.removeAll()
        }
        .onReceive(DeepLinkRouter.shared.$pendingFestival) { festival in
            guard let festival else { return }
            DeepLinkRouter.shared.pendingFestival = nil
            openDiscover(festival)
        }
        .onReceive(DeepLinkRouter.shared.$pendingEvent) { event in
            guard let event else { return }
            DeepLinkRouter.shared.pendingEvent = nil
            openDiscover(event)
        }
        .onReceive(DeepLinkRouter.shared.$pendingFestivalId) { id in
            guard let id else { return }
            DeepLinkRouter.shared.pendingFestivalId = nil
            // 위젯이 보여준 축제는 위젯 캐시에 그대로 있다.
            let cached = SharedFestivalCache.load(appGroupID: AppConfiguration.current.appGroupID)?
                .items
                .first(where: { $0.id == id })
            if let cached {
                openDiscover(cached)
            } else {
                // 서버 푸시는 id만 싣는다. 캐시에 없으면 상세를 받아 와서 연다.
                openTab(.discover).path.removeAll()
                Task { @MainActor in
                    if let festival = try? await apiClient.festival(id: id) {
                        openDiscover(festival)
                    }
                }
            }
        }
        .onReceive(DeepLinkRouter.shared.$pendingLocalEventId) { id in
            guard let id else { return }
            DeepLinkRouter.shared.pendingLocalEventId = nil
            openTab(.discover).path.removeAll()
            Task { @MainActor in
                if let event = try? await apiClient.localEvent(id: id) {
                    openDiscover(event)
                }
            }
        }
    }

    private func openDiscover(_ festival: Festival) {
        let router = openTab(.discover)
        router.path.removeAll()
        router.showResults(for: festival.discoverDestination, presentation: festival.discoverPresentation)
    }

    private func openDiscover(_ event: FreeEvent) {
        let router = openTab(.discover)
        router.path.removeAll()
        router.showResults(for: event.discoverDestination, presentation: event.discoverPresentation)
    }

    /// 딥링크로 탭을 전환한다. 아직 만들지 않은 탭이면 이번에 만들도록 표시하고, 그 탭의 라우터를 돌려준다.
    @discardableResult
    private func openTab(_ tab: AppTab) -> Router {
        tabRouter.selectedTab = tab
        visitedTabs.insert(tab)
        return routers.router(for: tab)
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

/// 탭마다 독립된 NavigationStack 경로를 갖도록 라우터를 탭 수만큼 들고 있는다.
final class TabRouters: ObservableObject {
    let map = Router()
    let discover = Router()
    let favorites = Router()
    let calendar = Router()
    let settings = Router()

    func router(for tab: AppTab) -> Router {
        switch tab {
        case .map: return map
        case .discover: return discover
        case .favorites: return favorites
        case .calendar: return calendar
        case .settings: return settings
        }
    }
}

private struct TabNavigationStack: View {
    @ObservedObject var router: Router
    let tab: AppTab
    let apiClient: APIClientProtocol

    var body: some View {
        NavigationStack(path: $router.path) {
            rootView
                .navigationDestination(for: AppRoute.self) { route in
                    routeDestination(for: route)
                }
        }
        .environmentObject(router)
    }

    @ViewBuilder
    private var rootView: some View {
        switch tab {
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
}

private struct FestivalTabBar: View {
    @Binding var selection: AppTab
    let onReselect: (AppTab) -> Void
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
            if isSelected {
                onReselect(tab)
            } else {
                selection = tab
            }
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
