import SwiftUI
import UIKit

enum AppRoute: Hashable {
    case parkingResults(Destination, DiscoverPresentation?)
    case parkingDetail(Destination, ParkingLot)
    case navigation(Destination, ParkingLot)
}

enum AppTab: Hashable {
    case map
    case discover
    case favorites
    case calendar
    case agentOffice
    case settings

    var title: String {
        switch self {
        case .map: return "지도"
        case .discover: return "이벤트"
        case .favorites: return "즐겨찾기"
        case .calendar: return "캘린더"
        case .agentOffice: return "사무실"
        case .settings: return "설정"
        }
    }

    var systemImage: String {
        switch self {
        case .map: return "map.fill"
        case .discover: return "sparkles"
        case .favorites: return "star.fill"
        case .calendar: return "calendar"
        case .agentOffice: return "building.2.fill"
        case .settings: return "gearshape.fill"
        }
    }

    static let visibleTabs: [AppTab] = [.map, .discover, .favorites, .calendar, .agentOffice, .settings]
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
                case .agentOffice:
                    AgentOfficeView(apiClient: apiClient)
                case .settings:
                    SettingsView(apiClient: apiClient)
                }
            }
            .id(tabRouter.selectedTab)
            .animation(.easeInOut(duration: 0.16), value: tabRouter.selectedTab)
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            FestivalTabBar(selection: $tabRouter.selectedTab)
                .ignoresSafeArea(.container, edges: .bottom)
        }
        .paperGrainOverlay()
        .tint(FestivalDesign.coral)
        .environmentObject(tabRouter)
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
            tabRouter.selectedTab = .discover
            router.path.removeAll()
            router.showResults(for: festival.discoverDestination, presentation: festival.discoverPresentation)
        }
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
        case .parkingDetail(let destination, let parkingLot):
            ParkingDetailView(destination: destination, parkingLot: parkingLot)
        case .navigation(let destination, let parkingLot):
            NavigationLaunchView(destination: destination, parkingLot: parkingLot)
        }
    }

    private static func configureTabBarAppearance() {
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(FestivalDesign.surface)
        appearance.shadowColor = UIColor(FestivalDesign.creamDeep.opacity(0.55))

        let selectedColor = UIColor(FestivalDesign.coral)
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
        appearance.backgroundColor = UIColor(FestivalDesign.surface)
        appearance.shadowColor = UIColor(FestivalDesign.creamDeep.opacity(0.55))

        let titleColor = UIColor(FestivalDesign.coral)
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
            LinearGradient(
                colors: [FestivalDesign.surface.opacity(0.99), FestivalDesign.cream.opacity(0.94)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea(edges: .bottom)
        )
        .overlay(
            Rectangle()
                .fill(FestivalDesign.isHandDrawn
                    ? FestivalDesign.outline.opacity(0.75)
                    : FestivalDesign.creamDeep.opacity(0.55))
                .frame(height: FestivalDesign.isHandDrawn ? 2 : 1),
            alignment: .top
        )
        .shadow(color: FestivalDesign.navy.opacity(0.10), radius: 8, y: -2)
    }

    private func tabButton(_ tab: AppTab) -> some View {
        let isSelected = selection == tab

        return Button {
            selection = tab
        } label: {
            VStack(spacing: 4) {
                Image(systemName: tab.systemImage)
                    .font(.festival(size: 15, weight: .bold))
                    .foregroundStyle(isSelected ? FestivalDesign.coral : FestivalDesign.secondaryText)
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

    func showDetail(destination: Destination, parkingLot: ParkingLot) {
        path.append(.parkingDetail(destination, parkingLot))
    }

    func startNavigation(destination: Destination, parkingLot: ParkingLot) {
        path.append(.navigation(destination, parkingLot))
    }
}
