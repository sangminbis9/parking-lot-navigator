import Foundation

struct Destination: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let address: String
    let lat: Double
    let lng: Double
    let source: String
    let rawCategory: String?
    let normalizedCategory: String?

    init(
        id: String,
        name: String,
        address: String,
        lat: Double,
        lng: Double,
        source: String,
        rawCategory: String? = nil,
        normalizedCategory: String? = nil
    ) {
        self.id = id
        self.name = name
        self.address = address
        self.lat = lat
        self.lng = lng
        self.source = source
        self.rawCategory = rawCategory
        self.normalizedCategory = normalizedCategory
    }
}

struct DestinationSearchResponse: Codable {
    let items: [Destination]
}
