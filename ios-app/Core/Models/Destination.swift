import Foundation

struct Destination: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let address: String
    let lat: Double
    let lng: Double
    let source: String
}

struct DestinationSearchResponse: Codable {
    let items: [Destination]
}
