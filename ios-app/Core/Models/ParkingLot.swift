import Foundation

enum CongestionStatus: String, Codable, Hashable {
    case available
    case moderate
    case busy
    case full
    case unknown

    var label: String {
        switch self {
        case .available: return "여유"
        case .moderate: return "보통"
        case .busy: return "혼잡"
        case .full: return "만차 임박"
        case .unknown: return "정보 없음"
        }
    }
}

struct ParkingProvenance: Codable, Hashable {
    let source: String
    let sourceParkingId: String
    let freshnessTimestamp: String?
}

struct ParkingLot: Codable, Hashable, Identifiable {
    let id: String
    let source: String
    let sourceParkingId: String
    let name: String
    let address: String
    let lat: Double
    let lng: Double
    let distanceFromDestinationMeters: Int
    let totalCapacity: Int?
    let availableSpaces: Int?
    let occupancyRate: Double?
    let congestionStatus: CongestionStatus
    let realtimeAvailable: Bool
    let freshnessTimestamp: String?
    let operatingHours: String?
    let feeSummary: String?
    let supportsEv: Bool
    let supportsAccessible: Bool
    let isPublic: Bool
    let isPrivate: Bool
    let stale: Bool
    let displayStatus: String
    let score: Double
    let provenance: [ParkingProvenance]
}

struct ParkingNearbyResponse: Codable {
    let destination: ParkingDestinationContext
    let items: [ParkingLot]
    let generatedAt: String
}

struct RealtimeParkingCluster: Codable, Hashable, Identifiable {
    let id: String
    let lat: Double
    let lng: Double
    let count: Int
    let availableSpaces: Int?
    let totalCapacity: Int?
    let congestionStatus: CongestionStatus
}

struct RealtimeParkingClustersResponse: Codable {
    let destination: ParkingDestinationContext
    let clusterMeters: Int
    let clusters: [RealtimeParkingCluster]
    let generatedAt: String
}

struct ParkingDestinationContext: Codable, Hashable {
    let lat: Double
    let lng: Double
    let radiusMeters: Int
}

struct ProviderHealth: Codable, Hashable, Identifiable {
    var id: String { name }
    let name: String
    let status: String
    let lastSuccessAt: String?
    let lastError: String?
    let qualityScore: Double
    let stale: Bool
}

struct ProviderHealthResponse: Codable {
    let providers: [ProviderHealth]
    let generatedAt: String
}
