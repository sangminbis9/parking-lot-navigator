import SwiftUI

@main
struct ParkingLotNavigatorApp: App {
    @StateObject private var destinationStore = DestinationStore()
    private let apiClient: APIClientProtocol = APIClient()

    var body: some Scene {
        WindowGroup {
            AppRootView(apiClient: apiClient)
                .environmentObject(destinationStore)
                .onOpenURL { url in
                    DeepLinkRouter.shared.handle(url)
                }
        }
    }
}
