import Combine
import CoreLocation
import Foundation

@MainActor
final class MapHomeViewModel: ObservableObject {
    @Published var query = ""
    @Published var destinations: [Destination] = []
    @Published var selectedDestination: Destination?
    @Published var parkingLots: [ParkingLot] = []
    @Published var selectedParkingLot: ParkingLot?
    @Published var isSearching = false
    @Published var isLoadingParking = false
    @Published var errorMessage: String?

    private let apiClient: APIClientProtocol

    init(apiClient: APIClientProtocol) {
        self.apiClient = apiClient
    }

    var recommendedParkingLots: [ParkingLot] {
        guard let selectedDestination else { return parkingLots }
        return parkingLots.sorted { lhs, rhs in
            let lhsOwnsDestination = isDestinationParking(lhs, for: selectedDestination)
            let rhsOwnsDestination = isDestinationParking(rhs, for: selectedDestination)
            if lhsOwnsDestination != rhsOwnsDestination {
                return lhsOwnsDestination
            }
            if lhs.realtimeAvailable != rhs.realtimeAvailable {
                return lhs.realtimeAvailable
            }
            return lhs.score > rhs.score
        }
    }

    func search() async {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        isSearching = true
        errorMessage = nil
        do {
            destinations = try await apiClient.searchDestination(query: trimmed)
        } catch {
            errorMessage = "목적지 검색에 실패했습니다. 네트워크 상태를 확인해 주세요."
        }
        isSearching = false
    }

    func select(_ destination: Destination) async {
        selectedDestination = destination
        destinations = []
        selectedParkingLot = nil
        await loadParkingLots(for: destination)
    }

    func loadParkingLots(for destination: Destination) async {
        isLoadingParking = true
        errorMessage = nil
        do {
            parkingLots = try await apiClient.nearbyParking(lat: destination.lat, lng: destination.lng, radiusMeters: 800)
            selectedParkingLot = recommendedParkingLots.first
        } catch {
            errorMessage = "주변 주차장을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
        }
        isLoadingParking = false
    }

    func isDestinationParking(_ parkingLot: ParkingLot, for destination: Destination) -> Bool {
        guard parkingLot.distanceFromDestinationMeters <= 120 else { return false }
        let destinationTokens = tokens(from: destination.name + " " + destination.address)
        let parkingTokens = tokens(from: parkingLot.name + " " + parkingLot.address)
        return !destinationTokens.isDisjoint(with: parkingTokens)
    }

    private func tokens(from text: String) -> Set<String> {
        let separators = CharacterSet.whitespacesAndNewlines
            .union(.punctuationCharacters)
            .union(.symbols)
        return Set(text
            .lowercased()
            .components(separatedBy: separators)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { $0.count >= 2 && !$0.contains("주차") })
    }
}

struct MapPinItem: Identifiable {
    enum Kind {
        case currentLocation
        case destination(Destination)
        case parking(ParkingLot)
    }

    let id: String
    let coordinate: CLLocationCoordinate2D
    let kind: Kind
}
