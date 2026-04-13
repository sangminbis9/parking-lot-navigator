import Foundation

final class KakaoNavigationService: NavigationService {
    private let bridge = KakaoNavigationBridge()

    func startNavigation(to parkingLot: ParkingLot, from destination: Destination) async throws {
        let request = KakaoNavigationRequest(
            destinationName: parkingLot.name,
            destinationLat: parkingLot.lat,
            destinationLng: parkingLot.lng
        )

        if bridge.isSDKAvailable() {
            bridge.startNavigation(with: request)
        } else {
            AppLogger.navigation.error("Kakao Mobility SDK가 설치되지 않아 mock fallback을 사용합니다.")
            try await MockNavigationService().startNavigation(to: parkingLot, from: destination)
        }
    }
}
