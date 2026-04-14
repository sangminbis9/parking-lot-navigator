import SwiftUI

enum AppRoute: Hashable {
    case parkingResults(Destination)
    case parkingDetail(Destination, ParkingLot)
    case navigation(Destination, ParkingLot)
}

struct AppRootView: View {
    let apiClient: APIClientProtocol
    @StateObject private var router = Router()

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

            RecentsView()
                .environmentObject(router)
                .tabItem { Label("최근", systemImage: "clock") }

            FavoritesView()
                .environmentObject(router)
                .tabItem { Label("즐겨찾기", systemImage: "star") }

            SettingsView(apiClient: apiClient)
                .tabItem { Label("설정", systemImage: "gear") }
        }
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
