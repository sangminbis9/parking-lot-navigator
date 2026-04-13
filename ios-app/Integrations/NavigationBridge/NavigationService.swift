import Foundation

protocol NavigationService {
    func startNavigation(to parkingLot: ParkingLot, from destination: Destination) async throws
}

enum NavigationServiceFactory {
    static func make() -> NavigationService {
        if AppConfiguration.current.navigationProvider == "kakao" {
            return KakaoNavigationService()
        }
        return MockNavigationService()
    }
}
