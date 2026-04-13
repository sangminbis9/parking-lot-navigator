import Foundation

@MainActor
final class ParkingResultsViewModel: ObservableObject {
    @Published var items: [ParkingLot] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let destination: Destination
    private let apiClient: APIClientProtocol

    init(destination: Destination, apiClient: APIClientProtocol) {
        self.destination = destination
        self.apiClient = apiClient
    }

    func load() async {
        isLoading = true
        errorMessage = nil
        do {
            items = try await apiClient.nearbyParking(lat: destination.lat, lng: destination.lng, radiusMeters: 800)
        } catch {
            errorMessage = "주변 주차장을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
        }
        isLoading = false
    }
}
