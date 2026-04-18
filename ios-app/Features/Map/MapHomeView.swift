import Combine
import CoreLocation
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
    @State private var mapZoomLevel = 13
    @State private var didAutoCenterOnLocation = false
    @State private var hasUserFocusedMapTarget = false
    @State private var shouldCenterOnNextLocation = false
    @FocusState private var isSearchFocused: Bool

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
            await viewModel.loadInitialDiscoverLayers()
            centerOnInitialDiscoverPinIfNeeded()
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
                tint: .purple,
                onOpenMap: {
                    openMaps(name: festival.title, latitude: festival.lat, longitude: festival.lng)
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
                tint: .teal,
                onOpenMap: {
                    openMaps(name: event.title, latitude: event.lat, longitude: event.lng)
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
            items.append(contentsOf: viewModel.visibleRealtimeParkingLots.map { parkingLot in
                MapPinItem(
                    id: "realtime-parking-\(parkingLot.id)",
                    coordinate: CLLocationCoordinate2D(latitude: parkingLot.lat, longitude: parkingLot.lng),
                    kind: .parking(parkingLot)
                )
            })
        }
        if viewModel.showsFestivalLayer {
            items.append(contentsOf: viewModel.festivals.map { festival in
                MapPinItem(
                    id: "festival-\(festival.id)",
                    coordinate: CLLocationCoordinate2D(latitude: festival.lat, longitude: festival.lng),
                    kind: .festival(festival),
                    showsTitleLabel: viewModel.selectedFestival?.id == festival.id
                )
            })
        }
        if viewModel.showsEventLayer {
            items.append(contentsOf: viewModel.events.map { event in
                MapPinItem(
                    id: "event-\(event.id)",
                    coordinate: CLLocationCoordinate2D(latitude: event.lat, longitude: event.lng),
                    kind: .event(event),
                    showsTitleLabel: viewModel.selectedEvent?.id == event.id
                )
            })
        }
        return items
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
        HStack(spacing: 8) {
            layerToggle(
                title: "\u{C2E4}\u{C2DC}\u{AC04} \u{24C5}",
                systemImage: "parkingsign.circle.fill",
                tint: .green,
                isOn: viewModel.showsRealtimeParkingLayer
            ) {
                Task { await viewModel.setRealtimeParkingLayerVisible(!viewModel.showsRealtimeParkingLayer) }
            }
            layerToggle(
                title: "\u{CD95}\u{C81C}",
                systemImage: "sparkles",
                tint: .purple,
                isOn: viewModel.showsFestivalLayer
            ) {
                Task { await viewModel.setFestivalLayerVisible(!viewModel.showsFestivalLayer, center: mapCenter) }
            }
            layerToggle(
                title: "\u{C774}\u{BCA4}\u{D2B8}",
                systemImage: "calendar",
                tint: .teal,
                isOn: viewModel.showsEventLayer
            ) {
                Task { await viewModel.setEventLayerVisible(!viewModel.showsEventLayer, center: mapCenter) }
            }
            if viewModel.isLoadingDiscover || viewModel.isLoadingRealtimeParking {
                ProgressView()
                    .controlSize(.small)
            }
            Spacer()
        }
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
        parkingPanel
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

    @ViewBuilder
    private var festivalPanel: some View {
        discoverPanel(title: "\u{CD95}\u{C81C}", items: viewModel.festivals, emptyText: "\u{ADFC}\u{CC98} \u{CD95}\u{C81C}\u{B97C} \u{CC3E}\u{C9C0} \u{BABB}\u{D588}\u{C2B5}\u{B2C8}\u{B2E4}.") { festival in
            DiscoverMapCard(
                title: festival.title,
                subtitle: festival.subtitle ?? festival.venueName ?? festival.address,
                meta: "\(festival.status.displayText) - \(festival.distanceMeters)m",
                tint: .purple,
                isSelected: viewModel.selectedFestival?.id == festival.id
            ) {
                viewModel.selectedFestival = festival
                viewModel.selectedEvent = nil
                focusMap(to: CLLocationCoordinate2D(latitude: festival.lat, longitude: festival.lng), zoomLevel: 16)
            }
        }
    }

    @ViewBuilder
    private var eventPanel: some View {
        discoverPanel(title: "\u{C774}\u{BCA4}\u{D2B8}", items: viewModel.events, emptyText: "\u{ADFC}\u{CC98} \u{BB34}\u{B8CC} \u{C774}\u{BCA4}\u{D2B8}\u{B97C} \u{CC3E}\u{C9C0} \u{BABB}\u{D588}\u{C2B5}\u{B2C8}\u{B2E4}.") { event in
            DiscoverMapCard(
                title: event.title,
                subtitle: event.shortDescription ?? event.venueName ?? event.address,
                meta: "\(event.status.displayText) - \(event.distanceMeters)m",
                tint: .teal,
                isSelected: viewModel.selectedEvent?.id == event.id
            ) {
                viewModel.selectedEvent = event
                viewModel.selectedFestival = nil
                focusMap(to: CLLocationCoordinate2D(latitude: event.lat, longitude: event.lng), zoomLevel: 16)
            }
        }
    }

    private func discoverPanel<Item: Identifiable, Content: View>(
        title: String,
        items: [Item],
        emptyText: String,
        @ViewBuilder content: @escaping (Item) -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title)
                    .font(.headline)
                Spacer()
                if viewModel.isLoadingDiscover {
                    ProgressView()
                }
            }

            if items.isEmpty && !viewModel.isLoadingDiscover {
                Text(emptyText)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(items) { item in
                            content(item)
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

    private func handlePinTap(_ pin: MapPinItem) {
        switch pin.kind {
        case .festival(let festival):
            focusMap(to: pin.coordinate, zoomLevel: 16)
            Task { await viewModel.selectFestival(festival) }
        case .event(let event):
            focusMap(to: pin.coordinate, zoomLevel: 16)
            Task { await viewModel.selectEvent(event) }
        case .parking(let parkingLot):
            viewModel.selectedParkingLot = parkingLot
            focusMap(to: pin.coordinate, zoomLevel: 17)
        case .destination(let destination):
            focusMap(to: CLLocationCoordinate2D(latitude: destination.lat, longitude: destination.lng), zoomLevel: 16)
        case .currentLocation:
            focusMap(to: pin.coordinate, zoomLevel: 15)
        }
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

private struct DiscoverMapCard: View {
    let title: String
    let subtitle: String
    let meta: String
    let tint: Color
    let isSelected: Bool
    let onSelect: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(meta)
                .font(.caption.weight(.semibold))
                .foregroundStyle(tint)
            Text(title)
                .font(.headline)
                .lineLimit(2)
            Text(subtitle)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
        .padding(12)
        .frame(width: 250, alignment: .leading)
        .background(isSelected ? tint.opacity(0.12) : Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(isSelected ? tint : .clear, lineWidth: 1.5)
        )
        .onTapGesture(perform: onSelect)
    }
}

private struct DiscoverDetailSheet: View {
    let title: String
    let subtitle: String?
    let statusText: String
    let dateText: String
    let venueName: String?
    let address: String
    let source: String
    let sourceUrl: String?
    let tint: Color
    let onOpenMap: () -> Void
    let onOpenSource: (URL) -> Void

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
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
                }

                HStack(spacing: 10) {
                    Button {
                        onOpenMap()
                    } label: {
                        Label("\u{C9C0}\u{B3C4} \u{C5F4}\u{AE30}", systemImage: "map")
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

                Spacer()
            }
            .padding(18)
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
