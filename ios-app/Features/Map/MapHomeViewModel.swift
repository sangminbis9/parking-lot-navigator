import Combine
import CoreLocation
import Foundation

@MainActor
final class MapHomeViewModel: ObservableObject {
    @Published var query = ""
    @Published var destinations: [Destination] = []
    @Published var selectedDestination: Destination?
    @Published var parkingLots: [ParkingLot] = []
    @Published var festivals: [Festival] = []
    @Published var events: [FreeEvent] = []
    @Published var selectedParkingLot: ParkingLot?
    @Published var selectedFestival: Festival?
    @Published var selectedEvent: FreeEvent?
    @Published var showsFestivalLayer = true
    @Published var showsEventLayer = true
    @Published var exploreMode: MapExploreMode = .parking
    @Published var isSearching = false
    @Published var isLoadingParking = false
    @Published var isLoadingDiscover = false
    @Published var errorMessage: String?

    private let apiClient: APIClientProtocol
    private let recommendationEngine = ParkingRecommendationEngine()

    init(apiClient: APIClientProtocol) {
        self.apiClient = apiClient
    }

    var parkingRecommendations: [ParkingRecommendation] {
        guard let selectedDestination else { return [] }
        return recommendationEngine.recommendations(for: parkingLots, destination: selectedDestination)
    }

    var recommendedParkingLots: [ParkingLot] {
        parkingRecommendations.map(\.parkingLot)
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
        let selectedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        exploreMode = .parking
        selectedDestination = destination
        destinations = []
        selectedParkingLot = nil
        parkingLots = []
        selectedFestival = nil
        selectedEvent = nil
        recordSelection(destination, queryText: selectedQuery)
        await loadParkingLots(for: destination)
    }

    func selectFestival(_ festival: Festival) async {
        selectedFestival = festival
        selectedEvent = nil
        await selectDiscoverDestination(
            id: "festival-\(festival.id)",
            name: festival.title,
            address: festival.address,
            lat: festival.lat,
            lng: festival.lng,
            source: festival.source,
            rawCategory: festival.tags.joined(separator: ","),
            normalizedCategory: "festival"
        )
    }

    func selectEvent(_ event: FreeEvent) async {
        selectedEvent = event
        selectedFestival = nil
        await selectDiscoverDestination(
            id: "event-\(event.id)",
            name: event.title,
            address: event.address,
            lat: event.lat,
            lng: event.lng,
            source: event.source,
            rawCategory: event.eventType,
            normalizedCategory: "event"
        )
    }

    func loadParkingLots(for destination: Destination) async {
        let destinationID = destination.id
        isLoadingParking = true
        errorMessage = nil
        do {
            let items = try await apiClient.nearbyParking(lat: destination.lat, lng: destination.lng, radiusMeters: 800)
            guard selectedDestination?.id == destinationID else { return }
            parkingLots = items
            selectedParkingLot = recommendedParkingLots.first
        } catch {
            guard selectedDestination?.id == destinationID else { return }
            errorMessage = "주변 주차장을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
        }
        if selectedDestination?.id == destinationID {
            isLoadingParking = false
        }
    }

    func setExploreMode(_ mode: MapExploreMode, center: CLLocationCoordinate2D) async {
        exploreMode = mode
        selectedFestival = nil
        selectedEvent = nil
        guard mode != .parking else { return }
        await loadDiscoverItems(center: center)
    }

    func setFestivalLayerVisible(_ isVisible: Bool, center: CLLocationCoordinate2D) async {
        showsFestivalLayer = isVisible
        if !isVisible {
            selectedFestival = nil
            return
        }
        if festivals.isEmpty {
            await loadFestivals(center: center)
        }
    }

    func setEventLayerVisible(_ isVisible: Bool, center: CLLocationCoordinate2D) async {
        showsEventLayer = isVisible
        if !isVisible {
            selectedEvent = nil
            return
        }
        if events.isEmpty {
            await loadEvents(center: center)
        }
    }

    func loadDiscoverLayers(center: CLLocationCoordinate2D) async {
        isLoadingDiscover = true
        errorMessage = nil
        do {
            if showsFestivalLayer {
                festivals = try await apiClient.nearbyFestivals(lat: center.latitude, lng: center.longitude, radiusMeters: 3000)
            }
            if showsEventLayer {
                events = try await apiClient.nearbyEvents(lat: center.latitude, lng: center.longitude, radiusMeters: 3000)
            }
        } catch {
            errorMessage = "\u{D0D0}\u{C0C9} \u{C815}\u{BCF4}\u{B97C} \u{BD88}\u{B7EC}\u{C624}\u{C9C0} \u{BABB}\u{D588}\u{C2B5}\u{B2C8}\u{B2E4}. \u{C7A0}\u{C2DC} \u{D6C4} \u{B2E4}\u{C2DC} \u{C2DC}\u{B3C4}\u{D574} \u{C8FC}\u{C138}\u{C694}."
        }
        isLoadingDiscover = false
    }

    func loadDiscoverItems(center: CLLocationCoordinate2D) async {
        isLoadingDiscover = true
        errorMessage = nil
        do {
            switch exploreMode {
            case .parking:
                break
            case .festivals:
                festivals = try await apiClient.nearbyFestivals(lat: center.latitude, lng: center.longitude, radiusMeters: 3000)
            case .events:
                events = try await apiClient.nearbyEvents(lat: center.latitude, lng: center.longitude, radiusMeters: 3000)
            }
        } catch {
            errorMessage = "탐색 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
        }
        isLoadingDiscover = false
    }

    private func loadFestivals(center: CLLocationCoordinate2D) async {
        isLoadingDiscover = true
        errorMessage = nil
        do {
            festivals = try await apiClient.nearbyFestivals(lat: center.latitude, lng: center.longitude, radiusMeters: 3000)
        } catch {
            errorMessage = "\u{CD95}\u{C81C} \u{C815}\u{BCF4}\u{B97C} \u{BD88}\u{B7EC}\u{C624}\u{C9C0} \u{BABB}\u{D588}\u{C2B5}\u{B2C8}\u{B2E4}."
        }
        isLoadingDiscover = false
    }

    private func loadEvents(center: CLLocationCoordinate2D) async {
        isLoadingDiscover = true
        errorMessage = nil
        do {
            events = try await apiClient.nearbyEvents(lat: center.latitude, lng: center.longitude, radiusMeters: 3000)
        } catch {
            errorMessage = "\u{C774}\u{BCA4}\u{D2B8} \u{C815}\u{BCF4}\u{B97C} \u{BD88}\u{B7EC}\u{C624}\u{C9C0} \u{BABB}\u{D588}\u{C2B5}\u{B2C8}\u{B2E4}."
        }
        isLoadingDiscover = false
    }

    private func selectDiscoverDestination(
        id: String,
        name: String,
        address: String,
        lat: Double,
        lng: Double,
        source: String,
        rawCategory: String?,
        normalizedCategory: String
    ) async {
        exploreMode = .parking
        let destination = Destination(
            id: id,
            name: name,
            address: address,
            lat: lat,
            lng: lng,
            source: source,
            rawCategory: rawCategory,
            normalizedCategory: normalizedCategory
        )
        selectedDestination = destination
        destinations = []
        selectedParkingLot = nil
        parkingLots = []
        await loadParkingLots(for: destination)
    }

    private func recordSelection(_ destination: Destination, queryText: String) {
        let deviceId = AnonymousDeviceStore.deviceID()
        Task {
            do {
                try await apiClient.recordSearchHistory(destination: destination, queryText: queryText, deviceId: deviceId)
            } catch {
                AppLogger.networking.warning("search history record failed: \(error.localizedDescription)")
            }
        }
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
        case festival(Festival)
        case event(FreeEvent)
    }

    let id: String
    let coordinate: CLLocationCoordinate2D
    let kind: Kind
}
