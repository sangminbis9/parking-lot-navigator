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

/// 선택된 핀과 사업자 직접 등록 핀처럼 클러스터에 흡수되면 안 되는 항목을 분리한다.
enum MapIndividualPinSelection {
    static func partition<Item: Identifiable>(
        _ items: [Item], selectedID: Item.ID?, alwaysIndividual: (Item) -> Bool
    ) -> (clusterable: [Item], individual: [Item]) {
        var clusterable: [Item] = []
        var individual: [Item] = []
        for item in items {
            if item.id == selectedID || alwaysIndividual(item) {
                individual.append(item)
            } else {
                clusterable.append(item)
            }
        }
        return (clusterable, individual)
    }
}
