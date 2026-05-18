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
    case agentOffice
    case favorites
    case settings
}

final class AppTabRouter: ObservableObject {
    @Published var selectedTab: AppTab = .map
    @Published var discoverFilterQuery: String?
}

struct AppRootView: View {
    let apiClient: APIClientProtocol
    @StateObject private var router = Router()
    @StateObject private var tabRouter = AppTabRouter()

    init(apiClient: APIClientProtocol) {
        self.apiClient = apiClient
        Self.configureTabBarAppearance()
    }

    var body: some View {
        TabView(selection: $tabRouter.selectedTab) {
            routedStack {
                MapHomeView(apiClient: apiClient)
            }
            .tabItem { Label("지도", systemImage: "map") }
            .tag(AppTab.map)

            routedStack {
                SearchView(apiClient: apiClient)
            }
            .tabItem { Label("\u{C774}\u{BCA4}\u{D2B8}", systemImage: "sparkles") }
            .tag(AppTab.discover)

            routedStack {
                FavoritesView()
            }
            .tabItem { Label("즐겨찾기", systemImage: "star") }
            .tag(AppTab.favorites)

            routedStack {
                AgentOfficeView(apiClient: apiClient)
            }
            .tabItem { Label("오피스", systemImage: "building.2") }
            .tag(AppTab.agentOffice)

            SettingsView(apiClient: apiClient)
                .tabItem { Label("설정", systemImage: "gear") }
                .tag(AppTab.settings)
        }
        .tint(FestivalDesign.coral)
        .environmentObject(tabRouter)
        .onChange(of: tabRouter.selectedTab) { _ in
            router.path.removeAll()
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
            .font: UIFont.systemFont(ofSize: 17, weight: .bold)
        ]
        appearance.largeTitleTextAttributes = [
            .foregroundColor: titleColor,
            .font: UIFont.systemFont(ofSize: 34, weight: .bold)
        ]

        UINavigationBar.appearance().standardAppearance = appearance
        UINavigationBar.appearance().compactAppearance = appearance
        UINavigationBar.appearance().scrollEdgeAppearance = appearance
        UINavigationBar.appearance().tintColor = titleColor
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
