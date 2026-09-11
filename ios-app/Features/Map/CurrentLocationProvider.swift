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

    /// 시스템 권한 팝업을 띄울 수 있는 유일한 경로. 사용자가 명시적으로 위치를 요청했을 때만 부른다.
    func request() {
        // UI 테스트는 시스템 권한 팝업을 다룰 수 없다. 이 인자가 있으면 요청 자체를 건너뛴다.
        if ProcessInfo.processInfo.arguments.contains("-uiTestingDenyLocation") { return }
        if manager.authorizationStatus == .notDetermined {
            manager.requestWhenInUseAuthorization()
            return
        }
        startIfAuthorized()
    }

    /// 이미 허용된 경우에만 위치를 받기 시작한다. 권한 팝업은 절대 띄우지 않는다.
    /// 화면이 뜨자마자 부르는 쪽은 반드시 이쪽을 쓴다.
    func startIfAuthorized() {
        if ProcessInfo.processInfo.arguments.contains("-uiTestingDenyLocation") { return }
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            guard !isUpdatingLocation else { return }
            isUpdatingLocation = true
            manager.startUpdatingLocation()
        case .notDetermined, .denied, .restricted:
            break
        @unknown default:
            break
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        authorizationStatus = manager.authorizationStatus
        // 권한이 방금 허용됐을 수 있다. 팝업을 다시 띄우지 않는 경로로만 이어 간다.
        startIfAuthorized()
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
        AppLogger.app.error("위치 수신 실패: \(error.localizedDescription, privacy: .public)")
        manager.stopUpdatingLocation()
        isUpdatingLocation = false
    }
}
