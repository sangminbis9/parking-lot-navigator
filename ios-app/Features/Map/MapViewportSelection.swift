import CoreLocation
import Foundation

/// 화면 밖만 제외한다. 클러스터링/프레임별 렌더는 별도 단계이며 결과 개수를 줄이지 않는다.
enum MapViewportSelection {
    static func sources<Item: Identifiable>(
        _ items: [Item], center: CLLocationCoordinate2D, radiusMeters: Int,
        selectedID: Item.ID?, coordinate: (Item) -> CLLocationCoordinate2D
    ) -> [Item] {
        let metersPerLat = 111_320.0
        let metersPerLng = metersPerLat * cos(center.latitude * .pi / 180)
        let radiusSquared = pow(Double(radiusMeters), 2)
        return items.filter { item in
            if let selectedID, item.id == selectedID { return true }
            let point = coordinate(item)
            let dy = (point.latitude - center.latitude) * metersPerLat
            let dx = (point.longitude - center.longitude) * metersPerLng
            return dx * dx + dy * dy <= radiusSquared
        }
    }
}
