import SwiftUI
import UIKit

enum AppRoute: Hashable {
    case parkingResults(Destination)
    case parkingDetail(Destination, ParkingLot)
    case navigation(Destination, ParkingLot)
}

struct AppRootView: View {
    let apiClient: APIClientProtocol
    @StateObject private var router = Router()

    init(apiClient: APIClientProtocol) {
        self.apiClient = apiClient
        Self.configureTabBarAppearance()
    }

    var body: some View {
        TabView {
            routedStack {
                MapHomeView(apiClient: apiClient)
            }
            .tabItem { Label("지도", systemImage: "map") }

            routedStack {
                SearchView(apiClient: apiClient)
            }
            .tabItem { Label("검색", systemImage: "magnifyingglass") }

            routedStack {
                FavoritesView()
            }
            .tabItem { Label("즐겨찾기", systemImage: "star") }

            SettingsView(apiClient: apiClient)
                .tabItem { Label("설정", systemImage: "gear") }
        }
        .tint(FestivalDesign.coral)
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
        case .parkingResults(let destination):
            ParkingResultsView(destination: destination, apiClient: apiClient)
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

    func showResults(for destination: Destination) {
        path.append(.parkingResults(destination))
    }

    func showDetail(destination: Destination, parkingLot: ParkingLot) {
        path.append(.parkingDetail(destination, parkingLot))
    }

    func startNavigation(destination: Destination, parkingLot: ParkingLot) {
        path.append(.navigation(destination, parkingLot))
    }
}
