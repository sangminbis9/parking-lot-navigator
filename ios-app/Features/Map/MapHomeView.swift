import Combine
import CoreLocation
import Foundation
import MapKit
import SwiftUI

struct MapHomeView: View {
    let apiClient: APIClientProtocol
    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var router: Router
    @EnvironmentObject private var destinationStore: DestinationStore
    @StateObject private var viewModel: MapHomeViewModel
    @StateObject private var locationProvider = CurrentLocationProvider()
    @State private var mapCenter = CLLocationCoordinate2D(latitude: 37.5665, longitude: 126.9780)
    @State private var mapViewport = MapViewport(
        center: CLLocationCoordinate2D(latitude: 37.5665, longitude: 126.9780),
        zoomLevel: 13,
        radiusMeters: 20_000
    )
    @State private var mapZoomLevel = 13
    @State private var didAutoCenterOnLocation = false
    @State private var hasUserFocusedMapTarget = false
    @State private var shouldCenterOnNextLocation = false
    @State private var discoverRefreshTask: Task<Void, Never>?
    @State private var lastDiscoverRefreshViewport: MapViewport?
    @State private var selectedPanelTab: MapPanelTab = .parking
    @State private var discoverListQuery = ""
    @State private var discoverListSort: DiscoverListSort = .distance
    @FocusState private var isSearchFocused: Bool
    private let overlayReleaseZoomLevel = 15
    private let discoverNameLabelZoomLevel = 17

    init(apiClient: APIClientProtocol) {
        self.apiClient = apiClient
        _viewModel = StateObject(wrappedValue: MapHomeViewModel(apiClient: apiClient))
    }

    var body: some View {
        ZStack(alignment: .top) {
            KakaoParkingMapView(center: mapCenter, zoomLevel: mapZoomLevel, pins: pins) {
                isSearchFocused = false
                clearMapFocus()
            } onPinTap: { pin in
                handlePinTap(pin)
            } onCameraIdle: { viewport in
                handleCameraIdle(viewport)
            }
            .ignoresSafeArea(edges: .top)

            VStack(spacing: 10) {
                searchPanel
                discoverLayerToggles
                if !viewModel.destinations.isEmpty {
                    destinationResults
                }
                if let errorMessage = viewModel.errorMessage {
                    inlineError(errorMessage)
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 12)

            VStack {
                Spacer()
                mapControls
                bottomPanel
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 12)
        }
        .navigationTitle("\u{C8FC}\u{CC28} \u{C9C0}\u{B3C4}")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            locationProvider.request()
            await viewModel.loadInitialDiscoverLayers(viewport: mapViewport)
            lastDiscoverRefreshViewport = mapViewport
            centerOnInitialDiscoverPinIfNeeded()
        }
        .onDisappear {
            discoverRefreshTask?.cancel()
        }
        .onReceive(locationProvider.$coordinate.compactMap { $0 }.prefix(1)) { coordinate in
            handleLocationUpdate(coordinate)
        }
        .sheet(item: $viewModel.selectedFestival) { festival in
            DiscoverDetailSheet(
                title: festival.title,
                subtitle: festival.subtitle,
                statusText: festival.status.displayText,
                dateText: "\(festival.startDate) - \(festival.endDate)",
                venueName: festival.venueName,
                address: festival.address,
                source: festival.source,
                sourceUrl: festival.sourceUrl,
                imageUrl: festival.imageUrl,
                tint: .purple,
                onOpenMap: {
                    showDiscoverItemOnMap(.festival(festival))
                },
                onOpenSource: { url in
                    openURL(url)
                }
            )
        }
        .sheet(item: $viewModel.selectedEvent) { event in
            DiscoverDetailSheet(
                title: event.title,
                subtitle: event.shortDescription,
                statusText: event.status.displayText,
                dateText: "\(event.startDate) - \(event.endDate)",
                venueName: event.venueName,
                address: event.address,
                source: event.source,
                sourceUrl: event.sourceUrl,
                imageUrl: event.imageUrl,
                tint: .teal,
                onOpenMap: {
                    showDiscoverItemOnMap(.event(event))
                },
                onOpenSource: { url in
                    openURL(url)
                }
            )
        }
        .sheet(item: $viewModel.selectedLodging) { lodging in
            DiscoverDetailSheet(
                title: lodging.name,
                subtitle: lodging.lowestPriceText.map { price in
                    if let platform = lodging.lowestPricePlatform {
                        return "\(price) · \(platform)"
                    }
                    return price
                },
                statusText: lodging.lodgingType,
                dateText: lodging.ratingText,
                venueName: lodging.lowestPricePlatform,
                address: lodging.address,
                source: lodging.source,
                sourceUrl: lodging.sourceUrl,
                imageUrl: lodging.imageUrl,
                tint: .indigo,
                extraRows: lodging.offers.map { offer in
                    DiscoverDetailExtraRow(label: offer.platform, value: offer.priceText)
                },
                onOpenMap: {
                    showDiscoverItemOnMap(.lodging(lodging))
                },
                onOpenSource: { url in
                    openURL(url)
                }
            )
        }
    }

    private var pins: [MapPinItem] {
        var items: [MapPinItem] = []
        if let coordinate = locationProvider.coordinate {
            items.append(MapPinItem(id: "current-location", coordinate: coordinate, kind: .currentLocation))
        }
        if let destination = viewModel.selectedDestination {
            items.append(MapPinItem(
                id: "destination-\(destination.id)",
                coordinate: CLLocationCoordinate2D(latitude: destination.lat, longitude: destination.lng),
                kind: .destination(destination)
            ))
        }
        items.append(contentsOf: viewModel.parkingLots.map { parkingLot in
            MapPinItem(
                id: "parking-\(parkingLot.id)",
                coordinate: CLLocationCoordinate2D(latitude: parkingLot.lat, longitude: parkingLot.lng),
                kind: .parking(parkingLot)
            )
        })
        if viewModel.showsRealtimeParkingLayer {
            items.append(contentsOf: realtimeParkingPins)
        }
        items.append(contentsOf: discoverPins)
        return items
    }

    private var realtimeParkingPins: [MapPinItem] {
        let sources = viewModel.visibleRealtimeParkingLots.map { RealtimeParkingPinSource(parkingLot: $0) }
        let groups = overlayGroups(sources)
        if mapZoomLevel < overlayReleaseZoomLevel {
            return groups.compactMap { group in
                group.first.map { source in
                    MapPinItem(id: "realtime-parking-\(source.parkingLot.id)", coordinate: source.coordinate, kind: .parking(source.parkingLot))
                }
            }
        }

        return groups.flatMap { group in
            group.enumerated().map { index, source in
                MapPinItem(
                    id: "realtime-parking-\(source.parkingLot.id)",
                    coordinate: overlayCoordinate(source.coordinate, index: index, count: group.count),
                    kind: .parking(source.parkingLot)
                )
            }
        }
    }

    private func overlayGroups<Source: OverlayPinSource>(_ sources: [Source]) -> [[Source]] {
        let groups = Dictionary(grouping: sources) { source in
            overlayKey(for: source.coordinate, zoomLevel: mapZoomLevel)
        }
        return groups.values
            .map { $0.sorted { $0.id < $1.id } }
            .sorted { ($0.first?.id ?? "") < ($1.first?.id ?? "") }
    }

    private var discoverPins: [MapPinItem] {
        let sources = discoverSources
        guard !sources.isEmpty else { return [] }

        let groups = overlayGroups(sources)
        if mapZoomLevel < overlayReleaseZoomLevel {
            return groups.compactMap { group in
                group.first.map { source in
                    mapPinItem(for: source, coordinate: source.coordinate)
                }
            }
        }

        return groups.flatMap { group in
            group.enumerated().map { index, source in
                mapPinItem(
                    for: source,
                    coordinate: overlayCoordinate(source.coordinate, index: index, count: group.count)
                )
            }
        }
    }

    private var discoverSources: [DiscoverPinSource] {
        var sources: [DiscoverPinSource] = []
        if viewModel.showsFestivalLayer {
            sources.append(contentsOf: viewModel.festivals.map { .festival($0) })
        }
        if viewModel.showsEventLayer {
            sources.append(contentsOf: viewModel.events.map { .event($0) })
        }
        if viewModel.showsLodgingLayer {
            sources.append(contentsOf: viewModel.lodging.map { .lodging($0) })
        }
        return sources
    }

    private var discoverListItems: [DiscoverListItem] {
        let query = discoverListQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let referenceCoordinate = locationProvider.coordinate
        let items = viewModel.festivals.map { DiscoverListItem.festival($0, referenceCoordinate: referenceCoordinate) } +
            viewModel.events.map { DiscoverListItem.event($0, referenceCoordinate: referenceCoordinate) } +
            viewModel.lodging.map { DiscoverListItem.lodging($0, referenceCoordinate: referenceCoordinate) }
        let filteredItems = query.isEmpty ? items : items.filter { $0.searchText.contains(query) }
        return filteredItems.sorted { lhs, rhs in
            switch discoverListSort {
            case .distance:
                if lhs.distanceMeters != rhs.distanceMeters {
                    return lhs.distanceMeters < rhs.distanceMeters
                }
                return lhs.title < rhs.title
            case .date:
                if lhs.startDate != rhs.startDate {
                    return lhs.startDate < rhs.startDate
                }
                return lhs.title < rhs.title
            case .name:
                return lhs.title < rhs.title
            }
        }
    }

    private func mapPinItem(for source: DiscoverPinSource, coordinate: CLLocationCoordinate2D) -> MapPinItem {
        switch source {
        case .festival(let festival):
            return MapPinItem(
                id: "festival-\(festival.id)",
                coordinate: coordinate,
                kind: .festival(festival),
                showsTitleLabel: mapZoomLevel >= discoverNameLabelZoomLevel
            )
        case .event(let event):
            return MapPinItem(
                id: "event-\(event.id)",
                coordinate: coordinate,
                kind: .event(event),
                showsTitleLabel: mapZoomLevel >= discoverNameLabelZoomLevel
            )
        case .lodging(let lodging):
            return MapPinItem(
                id: "lodging-\(lodging.id)",
                coordinate: coordinate,
                kind: .lodging(lodging),
                showsTitleLabel: mapZoomLevel >= discoverNameLabelZoomLevel
            )
        }
    }

    private func overlayCoordinate(_ coordinate: CLLocationCoordinate2D, index: Int, count: Int) -> CLLocationCoordinate2D {
        guard count > 1 else { return coordinate }
        let angle = (Double(index) / Double(count)) * 2 * Double.pi
        let radius = max(7.0, 36.0 / pow(2.0, Double(max(mapZoomLevel - overlayReleaseZoomLevel, 0))))
        return coordinate.offsetByMeters(east: cos(angle) * radius, north: sin(angle) * radius)
    }

    private func overlayKey(for coordinate: CLLocationCoordinate2D, zoomLevel: Int) -> String {
        let point = mercatorPoint(for: coordinate, zoomLevel: zoomLevel)
        let cellSize = zoomLevel < overlayReleaseZoomLevel ? 30.0 : 14.0
        return "\(Int((point.x / cellSize).rounded())):\(Int((point.y / cellSize).rounded()))"
    }

    private func mercatorPoint(for coordinate: CLLocationCoordinate2D, zoomLevel: Int) -> CGPoint {
        let sinLatitude = sin(coordinate.latitude * .pi / 180)
        let clampedSinLatitude = min(max(sinLatitude, -0.9999), 0.9999)
        let mapSize = 256.0 * pow(2.0, Double(zoomLevel))
        let x = (coordinate.longitude + 180.0) / 360.0 * mapSize
        let y = (0.5 - log((1 + clampedSinLatitude) / (1 - clampedSinLatitude)) / (4 * .pi)) * mapSize
        return CGPoint(x: x, y: y)
    }
    private var searchPanel: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
            TextField("\u{BAA9}\u{C801}\u{C9C0}, \u{C8FC}\u{C18C}, \u{C7A5}\u{C18C}\u{BA85}\u{C744} \u{C785}\u{B825}", text: $viewModel.query)
                .focused($isSearchFocused)
                .textInputAutocapitalization(.never)
                .submitLabel(.search)
                .onSubmit {
                    isSearchFocused = false
                    Task { await viewModel.search() }
                }
            if viewModel.isSearching {
                ProgressView()
            } else {
                Button("\u{AC80}\u{C0C9}") {
                    isSearchFocused = false
                    Task { await viewModel.search() }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
            }
        }
        .padding(12)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .shadow(color: .black.opacity(0.14), radius: 10, y: 4)
    }

    private var discoverLayerToggles: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                layerToggle(
                    title: "\u{C2E4}\u{C2DC}\u{AC04}",
                    systemImage: "parkingsign.circle.fill",
                    tint: .green,
                    isOn: viewModel.showsRealtimeParkingLayer
                ) {
                    Task {
                        await viewModel.setRealtimeParkingLayerVisible(!viewModel.showsRealtimeParkingLayer, center: mapCenter)
                        if viewModel.showsRealtimeParkingLayer {
                            await viewModel.loadRealtimeParkingLayer()
                        }
                    }
                }
                layerToggle(
                    title: "\u{CD95}\u{C81C}",
                    systemImage: "sparkles",
                    tint: .purple,
                    isOn: viewModel.showsFestivalLayer
                ) {
                    Task { await viewModel.setFestivalLayerVisible(!viewModel.showsFestivalLayer, viewport: mapViewport) }
                }
                layerToggle(
                    title: "\u{C774}\u{BCA4}\u{D2B8}",
                    systemImage: "calendar",
                    tint: .teal,
                    isOn: viewModel.showsEventLayer
                ) {
                    Task { await viewModel.setEventLayerVisible(!viewModel.showsEventLayer, viewport: mapViewport) }
                }
                layerToggle(
                    title: "\u{C219}\u{C18C}",
                    systemImage: "bed.double.fill",
                    tint: .indigo,
                    isOn: viewModel.showsLodgingLayer
                ) {
                    Task { await viewModel.setLodgingLayerVisible(!viewModel.showsLodgingLayer, viewport: mapViewport) }
                }
                if viewModel.isLoadingDiscover || viewModel.isLoadingRealtimeParking {
                    ProgressView()
                        .controlSize(.small)
                        .padding(.horizontal, 4)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func layerToggle(
        title: String,
        systemImage: String,
        tint: Color,
        isOn: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(isOn ? tint.opacity(0.18) : Color(.secondarySystemBackground))
                .foregroundStyle(isOn ? tint : .secondary)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(isOn ? tint.opacity(0.35) : .clear, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
        .accessibilityValue(isOn ? "\u{CF1C}\u{C9D0}" : "\u{AEBC}\u{C9D0}")
    }
    private var destinationResults: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(viewModel.destinations) { destination in
                    Button {
                        destinationStore.addRecent(destination)
                        focusMap(
                            to: CLLocationCoordinate2D(latitude: destination.lat, longitude: destination.lng),
                            zoomLevel: 16
                        )
                        Task { await viewModel.select(destination) }
                    } label: {
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: "mappin.circle.fill")
                                .foregroundStyle(.red)
                                .padding(.top, 2)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(destination.name)
                                    .font(.headline)
                                Text(destination.address)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                            }
                            Spacer()
                        }
                        .padding(12)
                    }
                    .buttonStyle(.plain)
                    Divider()
                        .padding(.leading, 40)
                }
            }
        }
        .frame(maxHeight: 230)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .shadow(color: .black.opacity(0.12), radius: 10, y: 4)
    }

    private var mapControls: some View {
        HStack {
            Spacer()
            Button {
                if let coordinate = locationProvider.coordinate {
                    moveMap(to: coordinate, zoomLevel: 15)
                } else {
                    shouldCenterOnNextLocation = true
                    locationProvider.request()
                }
            } label: {
                Image(systemName: "location.fill")
                    .font(.headline)
                    .frame(width: 42, height: 42)
            }
            .buttonStyle(.borderedProminent)
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }

    @ViewBuilder
    private var bottomPanel: some View {
        VStack(spacing: 8) {
            Picker("\u{C9C0}\u{B3C4} \u{C815}\u{BCF4}", selection: $selectedPanelTab) {
                ForEach(MapPanelTab.allCases) { tab in
                    Label(tab.title, systemImage: tab.systemImage).tag(tab)
                }
            }
            .pickerStyle(.segmented)

            switch selectedPanelTab {
            case .parking:
                if let selectedParkingLot = viewModel.selectedParkingLot,
                   !viewModel.parkingLots.contains(where: { $0.id == selectedParkingLot.id }) {
                    standaloneParkingPanel(parkingLot: selectedParkingLot)
                } else {
                    parkingPanel
                }
            case .discover:
                discoverListPanel
            }
        }
    }

    private func standaloneParkingPanel(parkingLot: ParkingLot) -> some View {
        StandaloneParkingMapCard(
            parkingLot: parkingLot,
            hasDestinationContext: viewModel.selectedDestination != nil,
            onOpenMap: {
                openMaps(name: parkingLot.name, latitude: parkingLot.lat, longitude: parkingLot.lng)
            },
            onDetail: {
                guard let destination = viewModel.selectedDestination else { return }
                router.showDetail(destination: destination, parkingLot: parkingLot)
            },
            onNavigate: {
                guard let destination = viewModel.selectedDestination else {
                    openMaps(name: parkingLot.name, latitude: parkingLot.lat, longitude: parkingLot.lng)
                    return
                }
                router.startNavigation(destination: destination, parkingLot: parkingLot)
            }
        )
    }

    @ViewBuilder
    private var parkingPanel: some View {
        if let destination = viewModel.selectedDestination {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(destination.name)
                            .font(.headline)
                        Text(destination.address)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer()
                    if viewModel.isLoadingParking {
                        ProgressView()
                    }
                }

                if viewModel.recommendedParkingLots.isEmpty && !viewModel.isLoadingParking {
                    Text("\u{C8FC}\u{BCC0} \u{C8FC}\u{CC28}\u{C7A5}\u{C744} \u{CC3E}\u{C9C0} \u{BABB}\u{D588}\u{C2B5}\u{B2C8}\u{B2E4}.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                } else {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(viewModel.parkingRecommendations) { recommendation in
                                let parkingLot = recommendation.parkingLot
                                ParkingMapCard(
                                    parkingLot: parkingLot,
                                    recommendation: recommendation,
                                    isDestinationParking: viewModel.isDestinationParking(parkingLot, for: destination),
                                    isSelected: viewModel.selectedParkingLot?.id == parkingLot.id,
                                    onSelect: {
                                        viewModel.selectedParkingLot = parkingLot
                                        focusMap(
                                            to: CLLocationCoordinate2D(latitude: parkingLot.lat, longitude: parkingLot.lng),
                                            zoomLevel: 17
                                        )
                                    },
                                    onDetail: {
                                        router.showDetail(destination: destination, parkingLot: parkingLot)
                                    },
                                    onNavigate: {
                                        router.startNavigation(destination: destination, parkingLot: parkingLot)
                                    }
                                )
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }
            }
            .padding(12)
            .background(.regularMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .shadow(color: .black.opacity(0.16), radius: 12, y: 6)
        }
    }

    private func inlineError(_ message: String) -> some View {
        Text(message)
            .font(.subheadline)
            .foregroundStyle(.white)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.red.opacity(0.88))
            .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func moveMap(to coordinate: CLLocationCoordinate2D, zoomLevel: Int) {
        mapCenter = coordinate
        mapZoomLevel = zoomLevel
    }

    private func focusMap(to coordinate: CLLocationCoordinate2D, zoomLevel: Int) {
        hasUserFocusedMapTarget = true
        shouldCenterOnNextLocation = false
        moveMap(to: coordinate, zoomLevel: zoomLevel)
    }

    private func clearMapFocus() {
        hasUserFocusedMapTarget = false
        shouldCenterOnNextLocation = false
        viewModel.clearMapFocus()
    }

    private func openMaps(name: String, latitude: Double, longitude: Double) {
        let placemark = MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: latitude, longitude: longitude))
        let item = MKMapItem(placemark: placemark)
        item.name = name
        item.openInMaps(launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDriving])
    }

    private func openDiscoverDetail(_ item: DiscoverListItem) {
        switch item.kind {
        case .festival(let festival):
            viewModel.selectedFestival = festival
            viewModel.selectedEvent = nil
            viewModel.selectedLodging = nil
        case .event(let event):
            viewModel.selectedEvent = event
            viewModel.selectedFestival = nil
            viewModel.selectedLodging = nil
        case .lodging(let lodging):
            viewModel.selectedLodging = lodging
            viewModel.selectedFestival = nil
            viewModel.selectedEvent = nil
        }
    }

    private func showDiscoverItemOnMap(_ kind: DiscoverListItem.Kind) {
        let coordinate: CLLocationCoordinate2D
        switch kind {
        case .festival(let festival):
            coordinate = CLLocationCoordinate2D(latitude: festival.lat, longitude: festival.lng)
        case .event(let event):
            coordinate = CLLocationCoordinate2D(latitude: event.lat, longitude: event.lng)
        case .lodging(let lodging):
            coordinate = CLLocationCoordinate2D(latitude: lodging.lat, longitude: lodging.lng)
        }
        selectedPanelTab = .parking
        focusMap(to: coordinate, zoomLevel: 16)
        Task {
            switch kind {
            case .festival(let festival):
                await viewModel.selectFestival(festival)
            case .event(let event):
                await viewModel.selectEvent(event)
            case .lodging(let lodging):
                await viewModel.selectLodging(lodging)
            }
            if !viewModel.showsRealtimeParkingLayer {
                await viewModel.setRealtimeParkingLayerVisible(true, center: coordinate)
            }
            await viewModel.loadRealtimeParkingLayer()
        }
    }

    private func handlePinTap(_ pin: MapPinItem) {
        switch pin.kind {
        case .festival(let festival):
            focusMap(to: pin.coordinate, zoomLevel: 16)
            Task { await viewModel.selectFestival(festival) }
        case .event(let event):
            focusMap(to: pin.coordinate, zoomLevel: 16)
            Task { await viewModel.selectEvent(event) }
        case .lodging(let lodging):
            focusMap(to: pin.coordinate, zoomLevel: 16)
            Task { await viewModel.selectLodging(lodging) }
        case .parking(let parkingLot):
            viewModel.selectedParkingLot = parkingLot
            focusMap(to: pin.coordinate, zoomLevel: 17)
        case .destination(let destination):
            focusMap(to: CLLocationCoordinate2D(latitude: destination.lat, longitude: destination.lng), zoomLevel: 16)
        case .currentLocation:
            focusMap(to: pin.coordinate, zoomLevel: 15)
        }
    }

    private var discoverListPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("\u{C774}\u{BCA4}\u{D2B8}\u{00B7}\u{CD95}\u{C81C}\u{00B7}\u{C219}\u{C18C}")
                    .font(.headline)
                Spacer()
                if viewModel.isLoadingDiscover || viewModel.isLoadingRealtimeParking {
                    ProgressView()
                        .controlSize(.small)
                }
            }

            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("\u{C774}\u{B984}, \u{C7A5}\u{C18C}, \u{C720}\u{D615} \u{AC80}\u{C0C9}", text: $discoverListQuery)
                    .textInputAutocapitalization(.never)
                    .submitLabel(.search)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(Color(.secondarySystemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 8))

            Picker("\u{C815}\u{B82C}", selection: $discoverListSort) {
                ForEach(DiscoverListSort.allCases) { sort in
                    Text(sort.title).tag(sort)
                }
            }
            .pickerStyle(.segmented)

            if discoverListItems.isEmpty && !viewModel.isLoadingDiscover {
                Text(discoverListQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "\u{D45C}\u{C2DC}\u{D560} \u{D0D0}\u{C0C9} \u{C815}\u{BCF4}\u{AC00} \u{C5C6}\u{C2B5}\u{B2C8}\u{B2E4}." : "\u{AC80}\u{C0C9} \u{ACB0}\u{ACFC}\u{AC00} \u{C5C6}\u{C2B5}\u{B2C8}\u{B2E4}.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 12)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(discoverListItems) { item in
                            DiscoverListRow(item: item) {
                                openDiscoverDetail(item)
                            }
                            if item.id != discoverListItems.last?.id {
                                Divider()
                                    .padding(.leading, 92)
                            }
                        }
                    }
                }
                .frame(maxHeight: 320)
            }
        }
        .padding(12)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .shadow(color: .black.opacity(0.16), radius: 12, y: 6)
    }

    private func centerOnInitialDiscoverPinIfNeeded() {
        guard !didAutoCenterOnLocation else { return }
        guard viewModel.selectedDestination == nil, viewModel.parkingLots.isEmpty else { return }
        if viewModel.showsFestivalLayer, let festival = viewModel.festivals.first {
            didAutoCenterOnLocation = true
            moveMap(to: CLLocationCoordinate2D(latitude: festival.lat, longitude: festival.lng), zoomLevel: 12)
            return
        }
        if viewModel.showsEventLayer, let event = viewModel.events.first {
            didAutoCenterOnLocation = true
            moveMap(to: CLLocationCoordinate2D(latitude: event.lat, longitude: event.lng), zoomLevel: 12)
            return
        }
        if viewModel.showsLodgingLayer, let lodging = viewModel.lodging.first {
            didAutoCenterOnLocation = true
            moveMap(to: CLLocationCoordinate2D(latitude: lodging.lat, longitude: lodging.lng), zoomLevel: 12)
        }
    }

    private func handleLocationUpdate(_ coordinate: CLLocationCoordinate2D) {
        if shouldCenterOnNextLocation {
            shouldCenterOnNextLocation = false
            didAutoCenterOnLocation = true
            moveMap(to: coordinate, zoomLevel: 15)
            return
        }

        guard !didAutoCenterOnLocation, !hasUserFocusedMapTarget, viewModel.selectedDestination == nil else {
            return
        }
        didAutoCenterOnLocation = true
        moveMap(to: coordinate, zoomLevel: 15)
    }

    private func handleCameraIdle(_ viewport: MapViewport) {
        mapCenter = viewport.center
        mapViewport = viewport
        mapZoomLevel = viewport.zoomLevel
        scheduleVisibleDiscoverRefresh(for: viewport)
    }

    private func scheduleVisibleDiscoverRefresh(for viewport: MapViewport) {
        guard viewModel.showsFestivalLayer || viewModel.showsEventLayer || viewModel.showsLodgingLayer else { return }
        guard shouldRefreshDiscover(for: viewport) else { return }
        discoverRefreshTask?.cancel()
        discoverRefreshTask = Task {
            try? await Task.sleep(nanoseconds: 650_000_000)
            guard !Task.isCancelled else { return }
            await viewModel.loadDiscoverLayers(viewport: viewport)
            await MainActor.run {
                lastDiscoverRefreshViewport = viewport
            }
        }
    }

    private func shouldRefreshDiscover(for viewport: MapViewport) -> Bool {
        guard let previous = lastDiscoverRefreshViewport else { return true }
        if viewport.zoomLevel != previous.zoomLevel { return true }
        let movedMeters = CLLocation(latitude: viewport.center.latitude, longitude: viewport.center.longitude)
            .distance(from: CLLocation(latitude: previous.center.latitude, longitude: previous.center.longitude))
        let movementThreshold = max(500, Double(viewport.radiusMeters) * 0.15)
        if movedMeters > movementThreshold { return true }
        let radiusDelta = abs(viewport.radiusMeters - previous.radiusMeters)
        return radiusDelta > max(1_000, viewport.radiusMeters / 5)
    }
}

private enum MapPanelTab: String, CaseIterable, Identifiable {
    case parking
    case discover

    var id: String { rawValue }

    var title: String {
        switch self {
        case .parking:
            return "\u{C8FC}\u{CC28}"
        case .discover:
            return "\u{D0D0}\u{C0C9}"
        }
    }

    var systemImage: String {
        switch self {
        case .parking:
            return "parkingsign.circle.fill"
        case .discover:
            return "sparkles"
        }
    }
}

private enum DiscoverListSort: String, CaseIterable, Identifiable {
    case distance
    case date
    case name

    var id: String { rawValue }

    var title: String {
        switch self {
        case .distance:
            return "\u{AC70}\u{B9AC}\u{C21C}"
        case .date:
            return "\u{B0A0}\u{C9DC}\u{C21C}"
        case .name:
            return "\u{C774}\u{B984}\u{C21C}"
        }
    }
}

private struct DiscoverListItem: Identifiable {
    enum Kind {
        case festival(Festival)
        case event(FreeEvent)
        case lodging(LodgingOption)
    }

    let id: String
    let kind: Kind
    let title: String
    let subtitle: String
    let dateText: String
    let startDate: String
    let statusText: String
    let distanceMeters: Int
    let imageUrl: String?
    let tint: Color
    let symbol: String
    let typeText: String
    let searchText: String

    static func festival(_ festival: Festival, referenceCoordinate: CLLocationCoordinate2D?) -> DiscoverListItem {
        DiscoverListItem(
            id: "festival-\(festival.id)",
            kind: .festival(festival),
            title: festival.title,
            subtitle: festival.subtitle ?? festival.venueName ?? festival.address,
            dateText: "\(festival.startDate) - \(festival.endDate)",
            startDate: festival.startDate,
            statusText: festival.status.displayText,
            distanceMeters: measuredDistanceMeters(
                from: referenceCoordinate,
                to: CLLocationCoordinate2D(latitude: festival.lat, longitude: festival.lng),
                fallback: festival.distanceMeters
            ),
            imageUrl: festival.imageUrl,
            tint: .purple,
            symbol: "sparkles",
            typeText: "\u{CD95}\u{C81C}",
            searchText: [
                festival.title,
                festival.subtitle,
                festival.venueName,
                festival.address,
                festival.tags.joined(separator: " ")
            ]
            .compactMap { $0 }
            .joined(separator: " ")
            .lowercased()
        )
    }

    static func event(_ event: FreeEvent, referenceCoordinate: CLLocationCoordinate2D?) -> DiscoverListItem {
        DiscoverListItem(
            id: "event-\(event.id)",
            kind: .event(event),
            title: event.title,
            subtitle: event.shortDescription ?? event.venueName ?? event.address,
            dateText: "\(event.startDate) - \(event.endDate)",
            startDate: event.startDate,
            statusText: event.status.displayText,
            distanceMeters: measuredDistanceMeters(
                from: referenceCoordinate,
                to: CLLocationCoordinate2D(latitude: event.lat, longitude: event.lng),
                fallback: event.distanceMeters
            ),
            imageUrl: event.imageUrl,
            tint: .teal,
            symbol: "calendar",
            typeText: event.eventType.isEmpty ? "\u{C774}\u{BCA4}\u{D2B8}" : event.eventType,
            searchText: [
                event.title,
                event.eventType,
                event.venueName,
                event.address,
                event.shortDescription
            ]
            .compactMap { $0 }
            .joined(separator: " ")
            .lowercased()
        )
    }

    static func lodging(_ lodging: LodgingOption, referenceCoordinate: CLLocationCoordinate2D?) -> DiscoverListItem {
        let priceText = lodging.lowestPriceText ?? "\u{C608}\u{C57D}\u{AC00} \u{BBF8}\u{C81C}\u{ACF5}"
        let ratingText = lodging.ratingText
        return DiscoverListItem(
            id: "lodging-\(lodging.id)",
            kind: .lodging(lodging),
            title: lodging.name,
            subtitle: "\(priceText) · \(ratingText)",
            dateText: lodging.lowestPricePlatform ?? lodging.source,
            startDate: "",
            statusText: lodging.lodgingType,
            distanceMeters: measuredDistanceMeters(
                from: referenceCoordinate,
                to: CLLocationCoordinate2D(latitude: lodging.lat, longitude: lodging.lng),
                fallback: lodging.distanceMeters
            ),
            imageUrl: lodging.imageUrl,
            tint: .indigo,
            symbol: "bed.double.fill",
            typeText: "\u{C219}\u{C18C}",
            searchText: [
                lodging.name,
                lodging.lodgingType,
                lodging.address,
                lodging.lowestPriceText,
                lodging.lowestPricePlatform,
                lodging.amenities.joined(separator: " "),
                lodging.offers.map { "\($0.platform) \($0.priceText)" }.joined(separator: " ")
            ]
            .compactMap { $0 }
            .joined(separator: " ")
            .lowercased()
        )
    }

    private static func measuredDistanceMeters(
        from referenceCoordinate: CLLocationCoordinate2D?,
        to coordinate: CLLocationCoordinate2D,
        fallback: Int
    ) -> Int {
        guard let referenceCoordinate else { return fallback }
        let referenceLocation = CLLocation(latitude: referenceCoordinate.latitude, longitude: referenceCoordinate.longitude)
        let itemLocation = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        return Int(referenceLocation.distance(from: itemLocation).rounded())
    }

    var distanceText: String {
        if distanceMeters >= 1_000 {
            let kilometers = Double(distanceMeters) / 1_000
            return String(format: "%.1fkm", kilometers)
        }
        return "\(distanceMeters)m"
    }
}

private protocol OverlayPinSource {
    var id: String { get }
    var coordinate: CLLocationCoordinate2D { get }
}

private struct RealtimeParkingPinSource: OverlayPinSource {
    let parkingLot: ParkingLot

    var id: String {
        "realtime-parking-\(parkingLot.id)"
    }

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: parkingLot.lat, longitude: parkingLot.lng)
    }
}

private enum DiscoverPinSource: OverlayPinSource {
    case festival(Festival)
    case event(FreeEvent)
    case lodging(LodgingOption)

    var id: String {
        switch self {
        case .festival(let festival):
            return "festival-\(festival.id)"
        case .event(let event):
            return "event-\(event.id)"
        case .lodging(let lodging):
            return "lodging-\(lodging.id)"
        }
    }

    var coordinate: CLLocationCoordinate2D {
        switch self {
        case .festival(let festival):
            return CLLocationCoordinate2D(latitude: festival.lat, longitude: festival.lng)
        case .event(let event):
            return CLLocationCoordinate2D(latitude: event.lat, longitude: event.lng)
        case .lodging(let lodging):
            return CLLocationCoordinate2D(latitude: lodging.lat, longitude: lodging.lng)
        }
    }
}

private extension CLLocationCoordinate2D {
    func offsetByMeters(east: Double, north: Double) -> CLLocationCoordinate2D {
        let latOffset = north / 111_320.0
        let lngOffset = east / max(40_000.0, 111_320.0 * cos(latitude * .pi / 180))
        return CLLocationCoordinate2D(latitude: latitude + latOffset, longitude: longitude + lngOffset)
    }
}

private struct ParkingMapCard: View {
    let parkingLot: ParkingLot
    let recommendation: ParkingRecommendation
    let isDestinationParking: Bool
    let isSelected: Bool
    let onSelect: () -> Void
    let onDetail: () -> Void
    let onNavigate: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                if isDestinationParking {
                    Text("\u{BAA9}\u{C801}\u{C9C0} \u{C8FC}\u{CC28}\u{C7A5}")
                        .font(.caption2.weight(.bold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(Color.green.opacity(0.16))
                        .foregroundStyle(.green)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                Text("\(parkingLot.distanceFromDestinationMeters)m")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
            }

            Text(parkingLot.name)
                .font(.headline)
                .lineLimit(2)
            HStack(spacing: 6) {
                Text("\u{CD94}\u{CC9C} \(recommendation.scorePercent)\u{C810}")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.blue)
                Text(recommendation.primaryReason)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Text(parkingLot.displayStatus)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(statusColor)
            Text(parkingLot.feeSummary ?? "\u{C694}\u{AE08} \u{C815}\u{BCF4} \u{C5C6}\u{C74C}")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)

            HStack {
                Button("\u{C0C1}\u{C138}") { onDetail() }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                Button("\u{ACBD}\u{B85C} \u{BCF4}\u{AE30}") { onNavigate() }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
            }
        }
        .padding(12)
        .frame(width: 250, alignment: .leading)
        .background(isSelected ? Color.blue.opacity(0.10) : Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(isSelected ? Color.blue : Color.clear, lineWidth: 2)
        )
        .onTapGesture(perform: onSelect)
    }

    private var statusColor: Color {
        switch parkingLot.congestionStatus {
        case .available:
            return .green
        case .moderate:
            return .orange
        case .busy, .full:
            return .red
        case .unknown:
            return .secondary
        }
    }
}

private struct StandaloneParkingMapCard: View {
    let parkingLot: ParkingLot
    let hasDestinationContext: Bool
    let onOpenMap: () -> Void
    let onDetail: () -> Void
    let onNavigate: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(parkingLot.name)
                        .font(.headline)
                        .lineLimit(2)
                    Text(parkingLot.address)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                Spacer()
                StatusBadge(
                    text: parkingLot.displayStatus,
                    kind: parkingLot.stale ? .warning : (parkingLot.realtimeAvailable ? .realtime : .neutral)
                )
            }

            HStack(spacing: 8) {
                parkingInfoPill(title: "가능", value: parkingLot.availableSpaces.map { "\($0)면" } ?? "정보 없음")
                parkingInfoPill(title: "전체", value: parkingLot.totalCapacity.map { "\($0)면" } ?? "정보 없음")
                parkingInfoPill(title: "요금", value: parkingLot.feeSummary ?? "정보 없음")
            }

            HStack {
                if parkingLot.source.hasSuffix("realtime") {
                    StatusBadge(text: "실시간", kind: .realtime)
                }
                StatusBadge(text: parkingLot.isPublic ? "공영" : "주차장", kind: .source)
                Spacer()
            }

            HStack {
                Button("지도 열기") { onOpenMap() }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                if hasDestinationContext {
                    Button("상세") { onDetail() }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                }
                Button("경로 보기") { onNavigate() }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
            }
        }
        .padding(12)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .shadow(color: .black.opacity(0.16), radius: 12, y: 6)
    }

    private func parkingInfoPill(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private extension DiscoverStatus {
    var displayText: String {
        switch self {
        case .ongoing:
            return "\u{C9C4}\u{D589} \u{C911}"
        case .upcoming:
            return "\u{C608}\u{C815}"
        }
    }
}

private extension LodgingOption {
    var ratingText: String {
        guard let rating else {
            return "\u{D3C9}\u{C810} \u{C815}\u{BCF4} \u{C5C6}\u{C74C}"
        }
        if let reviewCount {
            return String(format: "%.1f · %d reviews", rating, reviewCount)
        }
        return String(format: "%.1f", rating)
    }
}

private struct DiscoverListRow: View {
    let item: DiscoverListItem
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(alignment: .top, spacing: 12) {
                DiscoverThumbnail(imageUrl: item.imageUrl, tint: item.tint, symbol: item.symbol, size: 72)

                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        Text(item.typeText)
                            .font(.caption2.weight(.bold))
                            .padding(.horizontal, 7)
                            .padding(.vertical, 3)
                            .background(item.tint.opacity(0.14))
                            .foregroundStyle(item.tint)
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                        Text(item.statusText)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                        Spacer(minLength: 0)
                        Text(item.distanceText)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }

                    Text(item.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(2)

                    Text(item.subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)

                    Text(item.dateText)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct DiscoverThumbnail: View {
    let imageUrl: String?
    let tint: Color
    let symbol: String
    let size: CGFloat

    var body: some View {
        Group {
            if let imageUrl, let url = URL(string: imageUrl) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                    case .failure:
                        placeholder
                    case .empty:
                        ProgressView()
                    @unknown default:
                        placeholder
                    }
                }
            } else {
                placeholder
            }
        }
        .frame(width: size, height: size)
        .background(tint.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var placeholder: some View {
        Image(systemName: symbol)
            .font(.title3.weight(.semibold))
            .foregroundStyle(tint)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct DiscoverDetailSheet: View {
    @Environment(\.dismiss) private var dismiss

    let title: String
    let subtitle: String?
    let statusText: String
    let dateText: String
    let venueName: String?
    let address: String
    let source: String
    let sourceUrl: String?
    let imageUrl: String?
    let tint: Color
    var extraRows: [DiscoverDetailExtraRow] = []
    let onOpenMap: () -> Void
    let onOpenSource: (URL) -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    DiscoverDetailImage(imageUrl: imageUrl, tint: tint)

                    Text(statusText)
                        .font(.caption.weight(.bold))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(tint.opacity(0.14))
                        .foregroundStyle(tint)
                        .clipShape(RoundedRectangle(cornerRadius: 6))

                    Text(title)
                        .font(.title3.weight(.bold))
                        .fixedSize(horizontal: false, vertical: true)

                    if let subtitle, !subtitle.isEmpty {
                        Text(subtitle)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        detailRow(label: "\u{C77C}\u{C815}", value: dateText)
                        if let venueName, !venueName.isEmpty {
                            detailRow(label: "\u{C7A5}\u{C18C}", value: venueName)
                        }
                        detailRow(label: "\u{C8FC}\u{C18C}", value: address)
                        detailRow(label: "\u{CD9C}\u{CC98}", value: source)
                        ForEach(extraRows) { row in
                            detailRow(label: row.label, value: row.value)
                        }
                    }

                    HStack(spacing: 10) {
                        Button {
                            onOpenMap()
                            dismiss()
                        } label: {
                            Label("\u{B9F5}\u{C5D0}\u{C11C} \u{BCF4}\u{AE30}", systemImage: "map")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)

                        if let sourceUrl, let url = URL(string: sourceUrl) {
                            Button {
                                onOpenSource(url)
                            } label: {
                                Label("\u{C6D0}\u{BB38}", systemImage: "safari")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)
                        }
                    }

                    Spacer(minLength: 0)
                }
                .padding(18)
            }
            .navigationTitle("\u{C0C1}\u{C138} \u{C815}\u{BCF4}")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }

    private func detailRow(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.subheadline)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct DiscoverDetailExtraRow: Identifiable {
    let label: String
    let value: String

    var id: String { "\(label)-\(value)" }
}

private struct DiscoverDetailImage: View {
    let imageUrl: String?
    let tint: Color

    var body: some View {
        Group {
            if let imageUrl, let url = URL(string: imageUrl) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                    case .failure:
                        placeholder
                    case .empty:
                        ProgressView()
                    @unknown default:
                        placeholder
                    }
                }
            } else {
                placeholder
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: 180)
        .background(tint.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var placeholder: some View {
        ZStack {
            tint.opacity(0.12)
            Image(systemName: "photo")
                .font(.title2.weight(.semibold))
                .foregroundStyle(tint)
        }
    }
}
