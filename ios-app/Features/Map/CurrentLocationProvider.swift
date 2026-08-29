import Combine
import CoreLocation
import Foundation

final class CurrentLocationProvider: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var coordinate: CLLocationCoordinate2D?
    @Published var authorizationStatus: CLAuthorizationStatus = .notDetermined

    private let manager = CLLocationManager()
    private var isUpdatingLocation = false

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        authorizationStatus = manager.authorizationStatus
    }

    func request() {
        // UI 테스트는 시스템 권한 팝업을 다룰 수 없다. 이 인자가 있으면 요청 자체를 건너뛴다.
        if ProcessInfo.processInfo.arguments.contains("-uiTestingDenyLocation") { return }
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            guard !isUpdatingLocation else { return }
            isUpdatingLocation = true
            manager.startUpdatingLocation()
        case .denied, .restricted:
            break
        @unknown default:
            break
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        authorizationStatus = manager.authorizationStatus
        request()
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        coordinate = locations.last?.coordinate
        if let coordinate = locations.last?.coordinate {
            LastKnownLocationStore.save(lat: coordinate.latitude, lng: coordinate.longitude, appGroupID: AppConfiguration.current.appGroupID)
        }
        manager.stopUpdatingLocation()
        isUpdatingLocation = false
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        manager.stopUpdatingLocation()
        isUpdatingLocation = false
    }
}
