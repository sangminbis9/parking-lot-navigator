import Foundation

final class MockNavigationService: NavigationService {
    func startNavigation(to parkingLot: ParkingLot, from destination: Destination) async throws {
        AppLogger.navigation.info("mock 길안내 시작: \(destination.name) -> \(parkingLot.name)")
        try await Task.sleep(nanoseconds: 300_000_000)
    }
}
