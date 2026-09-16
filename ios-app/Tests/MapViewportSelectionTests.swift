import CoreLocation
import XCTest
@testable import ParkingLotNavigator

final class MapViewportSelectionTests: XCTestCase {
    private struct Source: Identifiable {
        let id: Int
        let coordinate: CLLocationCoordinate2D
    }

    func testAllVisibleSourcesSurviveBeyondOld600Limit() {
        let center = CLLocationCoordinate2D(latitude: 37.4, longitude: 126.6)
        let sources = (0..<1200).map { Source(id: $0, coordinate: center) }
        let visible = MapViewportSelection.sources(sources, center: center, radiusMeters: 3000, selectedID: nil, coordinate: { $0.coordinate })
        XCTAssertEqual(visible.count, 1200)
    }

    func testMovingViewportDoesNotReserveSlotsForInitialLocation() {
        let home = CLLocationCoordinate2D(latitude: 37.4, longitude: 126.6)
        let moved = CLLocationCoordinate2D(latitude: 35.2, longitude: 129.1)
        let sources = (0..<1200).map { Source(id: $0, coordinate: home) }
            + (1200..<2400).map { Source(id: $0, coordinate: moved) }
        let visible = MapViewportSelection.sources(sources, center: moved, radiusMeters: 3000, selectedID: 0, coordinate: { $0.coordinate })
        XCTAssertEqual(visible.count, 1201)
        XCTAssertEqual(visible.filter { $0.id >= 1200 }.count, 1200)
        XCTAssertEqual(visible.filter { $0.id < 1200 }.map(\.id), [0])
    }

    func testMerchantAndSelectedSourcesStayOutsideClusters() {
        let center = CLLocationCoordinate2D(latitude: 37.4, longitude: 126.6)
        let sources = (0..<5).map { Source(id: $0, coordinate: center) }
        let partition = MapIndividualPinSelection.partition(
            sources,
            selectedID: 1,
            alwaysIndividual: { $0.id == 4 }
        )
        XCTAssertEqual(partition.clusterable.map(\.id), [0, 2, 3])
        XCTAssertEqual(partition.individual.map(\.id), [1, 4])
    }
}
