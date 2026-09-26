import Foundation

/// 위치 권한이 없거나 아직 좌표를 받지 못했을 때 쓸 기준점.
///
/// 예전에는 어느 화면이든 서울시청 좌표로 고정돼 있어서, 전국 서비스인데도
/// 첫 화면이 항상 서울이라 서울 전용 앱처럼 보였다. 지금은
/// 마지막으로 알던 위치 → 서울 순으로 내려간다. (지도 필터의 지역 선택은 build 304에서 없어졌다.)
enum FallbackLocation {
    struct Resolved {
        let lat: Double
        let lng: Double
        /// 사용자에게 "지금 어디 기준으로 보고 있는지" 알려 줄 때 쓰는 이름.
        let label: String
    }

    static let seoul = Resolved(lat: 37.5663, lng: 126.9779, label: "서울")

    static func resolve(appGroupID: String = AppConfiguration.current.appGroupID) -> Resolved {
        if let last = LastKnownLocationStore.load(appGroupID: appGroupID) {
            return Resolved(lat: last.lat, lng: last.lng, label: "마지막 위치")
        }
        return seoul
    }
}
