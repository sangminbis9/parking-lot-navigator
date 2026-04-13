import AppIntents
import Foundation

struct ParkingDestinationEntity: AppEntity {
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "목적지")
    static var defaultQuery = ParkingDestinationQuery()

    let id: String
    let name: String
    let address: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", subtitle: "\(address)")
    }
}

struct ParkingDestinationQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [ParkingDestinationEntity] {
        identifiers.map { ParkingDestinationEntity(id: $0, name: "최근 목적지", address: "앱에서 확인") }
    }

    func suggestedEntities() async throws -> [ParkingDestinationEntity] {
        [
            ParkingDestinationEntity(id: "dest-seoul-station", name: "서울역", address: "서울 중구 한강대로 405"),
            ParkingDestinationEntity(id: "dest-cityhall", name: "서울시청", address: "서울 중구 세종대로 110")
        ]
    }
}
