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
            NavigationStack(path: $router.path) {
                MapHomeView(apiClient: apiClient)
                    .navigationDestination(for: AppRoute.self) { route in
                        switch route {
                        case .parkingResults(let destination):
                            ParkingResultsView(destination: destination, apiClient: apiClient)
                        case .parkingDetail(let destination, let parkingLot):
                            ParkingDetailView(destination: destination, parkingLot: parkingLot)
                        case .navigation(let destination, let parkingLot):
                            NavigationLaunchView(destination: destination, parkingLot: parkingLot)
                        }
                    }
            }
            .environmentObject(router)
            .tabItem { Label("지도", systemImage: "map") }

            NavigationStack(path: $router.path) {
                SearchView(apiClient: apiClient)
                    .navigationDestination(for: AppRoute.self) { route in
                        switch route {
                        case .parkingResults(let destination):
                            ParkingResultsView(destination: destination, apiClient: apiClient)
                        case .parkingDetail(let destination, let parkingLot):
                            ParkingDetailView(destination: destination, parkingLot: parkingLot)
                        case .navigation(let destination, let parkingLot):
                            NavigationLaunchView(destination: destination, parkingLot: parkingLot)
                        }
                    }
            }
            .environmentObject(router)
            .tabItem { Label("검색", systemImage: "magnifyingglass") }

            NavigationStack(path: $router.path) {
                FavoritesView()
                    .navigationDestination(for: AppRoute.self) { route in
                        switch route {
                        case .parkingResults(let destination):
                            ParkingResultsView(destination: destination, apiClient: apiClient)
                        case .parkingDetail(let destination, let parkingLot):
                            ParkingDetailView(destination: destination, parkingLot: parkingLot)
                        case .navigation(let destination, let parkingLot):
                            NavigationLaunchView(destination: destination, parkingLot: parkingLot)
                        }
                    }
            }
            .environmentObject(router)
            .tabItem { Label("즐겨찾기", systemImage: "star") }

            SettingsView(apiClient: apiClient)
                .tabItem { Label("설정", systemImage: "gear") }
        }
        .tint(FestivalDesign.teal)
    }

    private static func configureTabBarAppearance() {
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(FestivalDesign.surface)
        appearance.shadowColor = UIColor(FestivalDesign.creamDeep.opacity(0.55))

        let selectedColor = UIColor(FestivalDesign.teal)
        let normalColor = UIColor(FestivalDesign.navy.opacity(0.56))
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
