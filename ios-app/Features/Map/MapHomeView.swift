import Combine
import CoreLocation
import Foundation
import MapKit
import SwiftUI
import UIKit

struct MapHomeView: View {
    let apiClient: APIClientProtocol
    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var router: Router
    @EnvironmentObject private var tabRouter: AppTabRouter
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
    @State private var isHomeDiscoveryPanelDismissed = false
    @State private var discoverListQuery = ""
    @State private var discoverListSort: DiscoverListSort = .distance
    @State private var discoverFilters = DiscoverFilterState()
    @State private var hologramPin: MapPinItem?
    @State private var hologramAnchor: CGPoint = .zero
    @State private var hologramOverlayHeight: CGFloat = 130
    @State private var mapContainerSize: CGSize = .zero
    @State private var hologramAnchorTimer: Timer?
    @State private var mapProjector = MapProjector()
    @FocusState private var isSearchFocused: Bool
    private let overlayReleaseZoomLevel = 15
    private let discoverNameLabelZoomLevel = 17
    // KakaoMaps SDK가 UIImage 픽셀 크기를 pt로 취급해 렌더링
    // → screenPoint = 핀 이미지 바닥. 원형 상단 + 여유 10pt
    private var hologramPinTopOffset: CGFloat {
        (34 + 7 + 6) * 0.5 * UIScreen.main.scale + 10
    }
    private let hologramConnectorTotalHeight: CGFloat = 26  // 20pt bar + 6pt dot

    init(apiClient: APIClientProtocol) {
        self.apiClient = apiClient
        _viewModel = StateObject(wrappedValue: MapHomeViewModel(apiClient: apiClient))
    }

    var body: some View {
        ZStack(alignment: .top) {
            // Connector는 KakaoMap 아래 레이어 → 핀이 connector 앞에 보임
            Color.clear
                .ignoresSafeArea()
                .allowsHitTesting(false)
                .overlay(alignment: .topLeading) {
                    if hologramPin != nil {
                        hologramConnectorLayer()
                            .transition(.opacity)
                    }
                }

            KakaoParkingMapView(
                center: mapCenter,
                zoomLevel: mapZoomLevel,
                pins: pins,
                onTap: {
                    isSearchFocused = false
                    handleMapBackgroundTap()
                },
                onPinTap: { pin, tapPoint in
                    handlePinTap(pin, tapPoint: tapPoint)
                },
                onCameraIdle: { viewport in
                    handleCameraIdle(viewport)
                },
                projector: mapProjector
            )
            .ignoresSafeArea(edges: .top)
            .background(
                GeometryReader { proxy in
                    Color.clear
                        .onAppear { mapContainerSize = proxy.size }
                        .onChange(of: proxy.size) { newSize in
                            mapContainerSize = newSize
                        }
                }
            )
            .overlay(alignment: .topLeading) {
                if let pin = hologramPin {
                    hologramOverlay(for: pin)
                        .transition(.scale(scale: 0.85, anchor: .bottom).combined(with: .opacity))
                }
            }

            VStack(spacing: 10) {
                homeMapHeader
                VStack(spacing: 10) {
                    if !viewModel.destinations.isEmpty {
                        destinationResults
                    }
                    if let errorMessage = viewModel.errorMessage {
                        inlineError(errorMessage)
                    }
                }
                .padding(.horizontal, 14)
            }
            .padding(.top, 0)

            VStack {
                Spacer()
                mapControls
                bottomPanel
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 12)
        }
        .toolbar(.hidden, for: .navigationBar)
        .task {
            locationProvider.request()
            await viewModel.loadInitialDiscoverLayers(viewport: mapViewport)
            lastDiscoverRefreshViewport = mapViewport
            centerOnInitialDiscoverPinIfNeeded()
        }
        .onDisappear {
            discoverRefreshTask?.cancel()
            stopHologramAnchorTracking()
        }
        .onChange(of: hologramPin?.id) { _ in
            if hologramPin != nil {
                startHologramAnchorTracking()
            } else {
                stopHologramAnchorTracking()
            }
        }
        .onReceive(locationProvider.$coordinate.compactMap { $0 }.prefix(1)) { coordinate in
            handleLocationUpdate(coordinate)
        }
        .sheet(item: $viewModel.selectedFestival) { festival in
            DiscoverDetailSheet(
                title: festival.title,
                subtitle: festival.subtitle,
                description: festival.description,
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
                subtitle: event.benefit ?? event.shortDescription,
                description: event.shortDescription,
                statusText: event.timelineStatus.displayText,
                dateText: event.dateText,
                venueName: event.venueName ?? event.storeName,
                address: event.address,
                source: event.isSponsored ? "\(event.source) · sponsored" : event.source,
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
        items.append(contentsOf: parkingPins)
        if viewModel.showsRealtimeParkingLayer || viewModel.selectedDiscoverParkingContext {
            items.append(contentsOf: realtimeParkingPins)
        }
        items.append(contentsOf: discoverPins)
        return items
    }

    private var parkingPins: [MapPinItem] {
        let sources = viewModel.parkingLots.map { ParkingPinSource(parkingLot: $0, prefix: "parking") }
        let groups = overlayGroups(sources)
        if mapZoomLevel < overlayReleaseZoomLevel {
            return groups.compactMap { group in
                if let cluster = clusterPin(for: group, idPrefix: "parking-cluster", tint: FestivalDesign.uiParkingBlue, isParking: true) {
                    return cluster
                }
                return group.first.map { source in
                    MapPinItem(id: "parking-\(source.parkingLot.id)", coordinate: source.coordinate, kind: .parking(source.parkingLot))
                }
            }
        }

        return groups.flatMap { group in
            group.enumerated().map { index, source in
                MapPinItem(
                    id: "parking-\(source.parkingLot.id)",
                    coordinate: overlayCoordinate(source.coordinate, index: index, count: group.count),
                    kind: .parking(source.parkingLot)
                )
            }
        }
    }

    private var realtimeParkingPins: [MapPinItem] {
        let sources = viewModel.visibleRealtimeParkingLots.map { RealtimeParkingPinSource(parkingLot: $0) }
        let groups = overlayGroups(sources)
        if mapZoomLevel < overlayReleaseZoomLevel {
            return groups.compactMap { group in
                if let cluster = clusterPin(for: group, idPrefix: "realtime-parking-cluster", tint: FestivalDesign.uiParkingBlue, isParking: true) {
                    return cluster
                }
                return group.first.map { source in
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
                if let cluster = clusterPin(for: group, idPrefix: "discover-cluster", tint: FestivalDesign.uiTeal, isParking: false) {
                    return cluster
                }
                return group.first.map { source in
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
        if viewModel.showsLocalEventLayer {
            sources.append(contentsOf: viewModel.events.map { .event($0) })
        }
        return sources
    }

    private var discoverListItems: [DiscoverListItem] {
        let referenceCoordinate = locationProvider.coordinate
        return viewModel.festivals.map { DiscoverListItem.festival($0, referenceCoordinate: referenceCoordinate) } +
            viewModel.events.map { DiscoverListItem.event($0, referenceCoordinate: referenceCoordinate) }
    }

    private var visibleDiscoverSources: [DiscoverPinSource] {
        let sources = discoverSources
        guard !sources.isEmpty else { return [] }
        let center = CLLocation(
            latitude: mapViewport.center.latitude,
            longitude: mapViewport.center.longitude
        )
        let radius = Double(mapViewport.radiusMeters)
        return sources.filter { source in
            let point = CLLocation(
                latitude: source.coordinate.latitude,
                longitude: source.coordinate.longitude
            )
            return center.distance(from: point) <= radius
        }
    }

    private var discoverItemCount: Int {
        visibleDiscoverSources.count
    }

    private var firstDiscoverListItem: DiscoverListItem? {
        let referenceCoordinate = locationProvider.coordinate
        switch visibleDiscoverSources.first {
        case .festival(let festival):
            return DiscoverListItem.festival(festival, referenceCoordinate: referenceCoordinate)
        case .event(let event):
            return DiscoverListItem.event(event, referenceCoordinate: referenceCoordinate)
        case nil:
            return nil
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
        }
    }

    private func clusterPin<Source: OverlayPinSource>(
        for group: [Source],
        idPrefix: String,
        tint: UIColor,
        isParking: Bool
    ) -> MapPinItem? {
        guard group.count > 1 else { return nil }
        let coordinates = group.map(\.coordinate)
        let center = clusterCenter(for: coordinates)
        let cluster = MapPinCluster(
            id: "\(idPrefix)-\(overlayKey(for: center, zoomLevel: mapZoomLevel))-\(group.count)",
            coordinate: center,
            count: group.count,
            memberCoordinates: coordinates,
            tint: tint,
            isParking: isParking
        )
        return MapPinItem(id: cluster.id, coordinate: center, kind: .cluster(cluster))
    }

    private func clusterCenter(for coordinates: [CLLocationCoordinate2D]) -> CLLocationCoordinate2D {
        guard !coordinates.isEmpty else { return mapCenter }
        let latitude = coordinates.map(\.latitude).reduce(0, +) / Double(coordinates.count)
        let longitude = coordinates.map(\.longitude).reduce(0, +) / Double(coordinates.count)
        return CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
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
    private var homeMapHeader: some View {
        VStack(alignment: .leading, spacing: 9) {
            searchPanel
            discoverLayerToggles
        }
        .padding(.horizontal, 14)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .background(
            LinearGradient(
                colors: [
                    FestivalDesign.surface.opacity(0.98),
                    FestivalDesign.cream.opacity(0.86),
                    FestivalDesign.tealSoft.opacity(0.92)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(FestivalDesign.creamDeep.opacity(0.45))
                .frame(height: 1)
        }
        .shadow(color: FestivalDesign.navy.opacity(0.12), radius: 12, y: 5)
    }

    private var searchPanel: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(FestivalDesign.teal)
            TextField(
                "",
                text: $viewModel.query,
                prompt: Text("축제, 장소, 주소 검색")
                    .foregroundColor(FestivalDesign.secondaryText)
            )
                .focused($isSearchFocused)
                .textInputAutocapitalization(.never)
                .submitLabel(.search)
                .onSubmit {
                    isSearchFocused = false
                    Task { await viewModel.search() }
                }

            Button {
                isSearchFocused = false
                Task { await viewModel.search() }
            } label: {
                Group {
                    if viewModel.isSearching {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: "arrow.right")
                            .font(.subheadline.weight(.bold))
                    }
                }
                .frame(width: 34, height: 34)
                .background(FestivalDesign.teal)
                .foregroundStyle(.white)
                .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .disabled(viewModel.isSearching)
            .accessibilityLabel("검색")
        }
        .padding(.leading, 12)
        .padding(.trailing, 6)
        .padding(.vertical, 6)
        .background(FestivalDesign.surface)
        .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.controlRadius))
        .overlay(
            RoundedRectangle(cornerRadius: FestivalDesign.controlRadius)
                .stroke(FestivalDesign.creamDeep.opacity(0.45), lineWidth: 1)
        )
    }

    private var discoverLayerToggles: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 7) {
                layerToggle(
                    title: "\u{C8FC}\u{CC28}",
                    systemImage: "parkingsign.circle.fill",
                    tint: FestivalDesign.parkingBlue,
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
                    tint: FestivalDesign.coral,
                    isOn: viewModel.showsFestivalLayer
                ) {
                    Task { await viewModel.setFestivalLayerVisible(!viewModel.showsFestivalLayer, viewport: mapViewport) }
                }
                layerToggle(
                    title: "\u{C774}\u{BCA4}\u{D2B8}",
                    systemImage: "tag.fill",
                    tint: FestivalDesign.teal,
                    isOn: viewModel.showsLocalEventLayer
                ) {
                    Task { await viewModel.setLocalEventLayerVisible(!viewModel.showsLocalEventLayer, viewport: mapViewport) }
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
                .font(.caption.weight(.bold))
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(isOn ? tint : FestivalDesign.surface.opacity(0.92))
                .foregroundStyle(isOn ? .white : FestivalDesign.secondaryText)
                .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.controlRadius))
                .overlay(
                    RoundedRectangle(cornerRadius: FestivalDesign.controlRadius)
                        .stroke(isOn ? Color.white.opacity(0.25) : FestivalDesign.creamDeep.opacity(0.45), lineWidth: 1)
                )
                .shadow(color: isOn ? tint.opacity(0.22) : .clear, radius: 7, y: 3)
        }
        .buttonStyle(.plain)
        .accessibilityValue(isOn ? "\u{CF1C}\u{C9D0}" : "\u{AEBC}\u{C9D0}")
    }
    private var destinationResults: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(viewModel.destinations) { destination in
                    Button {
                        isSearchFocused = false
                        destinationStore.addRecent(destination)
                        focusMap(
                            to: CLLocationCoordinate2D(latitude: destination.lat, longitude: destination.lng),
                            zoomLevel: 16
                        )
                        Task { await viewModel.select(destination) }
                    } label: {
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: "mappin.circle.fill")
                                .foregroundStyle(FestivalDesign.coral)
                                .padding(.top, 2)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(destination.name)
                                    .font(.headline)
                                    .foregroundStyle(FestivalDesign.navy)
                                Text(destination.address)
                                    .font(.subheadline)
                                    .foregroundStyle(FestivalDesign.secondaryText)
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
        .scrollDismissesKeyboard(.interactively)
        .simultaneousGesture(TapGesture().onEnded {
            isSearchFocused = false
        })
        .frame(maxHeight: 230)
        .background(FestivalDesign.surface.opacity(0.96))
        .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
        .overlay(
            RoundedRectangle(cornerRadius: FestivalDesign.cardRadius)
                .stroke(FestivalDesign.creamDeep.opacity(0.45), lineWidth: 1)
        )
        .shadow(color: FestivalDesign.navy.opacity(0.12), radius: 10, y: 4)
    }

    private var mapControls: some View {
        HStack(alignment: .bottom) {
            Spacer()
            VStack(spacing: 10) {
                Button {
                    tabRouter.selectedTab = .discover
                } label: {
                    MapFloatingIcon(systemName: "list.bullet.rectangle.portrait.fill", tint: FestivalDesign.teal, size: 48)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\u{D0D0}\u{C0C9} \u{BAA9}\u{B85D} \u{C5F4}\u{AE30}")

                Button {
                    if let coordinate = locationProvider.coordinate {
                        moveMap(to: coordinate, zoomLevel: 15)
                    } else {
                        shouldCenterOnNextLocation = true
                        locationProvider.request()
                    }
                } label: {
                    MapFloatingIcon(systemName: "location.fill", tint: FestivalDesign.parkingBlue, size: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\u{B0B4} \u{C704}\u{CE58}\u{B85C} \u{C774}\u{B3D9}")
            }
        }
    }

    @ViewBuilder
    private var bottomPanel: some View {
        if let selectedParkingLot = viewModel.selectedParkingLot,
           !viewModel.parkingLots.contains(where: { $0.id == selectedParkingLot.id }) {
            standaloneParkingPanel(parkingLot: selectedParkingLot)
        } else {
            if viewModel.selectedDestination != nil {
                parkingPanel
            } else if !isHomeDiscoveryPanelDismissed {
                homeDiscoveryPanel
            }
        }
    }

    private var homeDiscoveryPanel: some View {
        ZStack(alignment: .topTrailing) {
            HStack(spacing: 12) {
                Image("FestivalMascotGuide")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 64, height: 64)
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Text("주변 축제부터 둘러보세요")
                            .font(.headline)
                            .foregroundStyle(FestivalDesign.navy)
                        Text("\(discoverItemCount)")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(FestivalDesign.teal)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(FestivalDesign.tealSoft)
                            .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.controlRadius))
                            .accessibilityLabel("현재 지도 기준 주변 이벤트와 축제 \(discoverItemCount)개")
                    }
                    Text("마음에 드는 장소를 고르면 근처 주차장까지 이어서 안내합니다.")
                        .font(.caption)
                        .foregroundStyle(FestivalDesign.secondaryText)
                        .lineLimit(2)

                    HStack(spacing: 8) {
                        Button {
                            tabRouter.selectedTab = .discover
                        } label: {
                            Label("탐색 목록", systemImage: "sparkles")
                        }
                        .buttonStyle(HomeMapPillButtonStyle(tint: FestivalDesign.teal, isFilled: true))

                        Button {
                            if let first = firstDiscoverListItem {
                                openDiscoverResults(first.kind)
                            }
                        } label: {
                            Label("추천 보기", systemImage: "mappin.and.ellipse")
                        }
                        .buttonStyle(HomeMapPillButtonStyle(tint: FestivalDesign.coral, isFilled: false))
                        .disabled(discoverItemCount == 0)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(14)
            .padding(.trailing, 20)

            Button {
                isHomeDiscoveryPanelDismissed = true
            } label: {
                Image(systemName: "xmark")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .frame(width: 28, height: 28)
                    .background(FestivalDesign.cream.opacity(0.55))
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .padding(8)
            .accessibilityLabel("안내 카드 닫기")
        }
        .background(FestivalDesign.surface.opacity(0.97))
        .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
        .overlay(
            RoundedRectangle(cornerRadius: FestivalDesign.cardRadius)
                .stroke(FestivalDesign.creamDeep.opacity(0.5), lineWidth: 1)
        )
        .shadow(color: FestivalDesign.navy.opacity(0.14), radius: 14, y: 7)
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
                            .foregroundStyle(FestivalDesign.navy)
                        Text(destination.address)
                            .font(.caption)
                            .foregroundStyle(FestivalDesign.secondaryText)
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
                        .foregroundStyle(FestivalDesign.secondaryText)
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
            .background(FestivalDesign.surface.opacity(0.97))
            .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
            .overlay(
                RoundedRectangle(cornerRadius: FestivalDesign.cardRadius)
                    .stroke(FestivalDesign.creamDeep.opacity(0.5), lineWidth: 1)
            )
            .shadow(color: FestivalDesign.navy.opacity(0.14), radius: 12, y: 6)
        }
    }

    private func inlineError(_ message: String) -> some View {
        Text(message)
            .font(.subheadline)
            .foregroundStyle(.white)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(FestivalDesign.coral.opacity(0.9))
            .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
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
        openDiscoverResults(item.kind)
    }

    private func openDiscoverResults(_ kind: DiscoverListItem.Kind) {
        switch kind {
        case .festival(let festival):
            destinationStore.addRecent(festival.discoverDestination)
            router.showResults(for: festival.discoverDestination, presentation: festival.discoverPresentation)
        case .event(let event):
            destinationStore.addRecent(event.discoverDestination)
            router.showResults(for: event.discoverDestination, presentation: event.discoverPresentation)
        }
    }

    private func showDiscoverItemOnMap(_ kind: DiscoverListItem.Kind) {
        let coordinate: CLLocationCoordinate2D
        switch kind {
        case .festival(let festival):
            coordinate = CLLocationCoordinate2D(latitude: festival.lat, longitude: festival.lng)
        case .event(let event):
            coordinate = CLLocationCoordinate2D(latitude: event.lat, longitude: event.lng)
        }
        tabRouter.selectedTab = .map
        focusMap(to: coordinate, zoomLevel: 16)
        Task {
            switch kind {
            case .festival(let festival):
                await viewModel.selectFestival(festival)
            case .event(let event):
                await viewModel.selectEvent(event)
            }
            if !viewModel.showsRealtimeParkingLayer {
                await viewModel.setRealtimeParkingLayerVisible(true, center: coordinate)
            }
            await viewModel.loadRealtimeParkingLayer()
        }
    }

    private func handleMapBackgroundTap() {
        // 1차 탭: 홀로그램이 떠 있으면 홀로그램만 끄고 주변 주차장은 유지
        if hologramPin != nil {
            withAnimation(.easeOut(duration: 0.18)) {
                hologramPin = nil
            }
            return
        }
        // 2차 탭(또는 빈 지도 탭): 핀에서 띄운 주변 주차장까지 정리
        clearMapFocus()
    }

    private func handlePinTap(_ pin: MapPinItem, tapPoint: CGPoint?) {
        switch pin.kind {
        case .cluster(let cluster):
            hologramPin = nil
            viewModel.selectedParkingLot = nil
            focusMap(to: cluster.coordinate, zoomLevel: zoomLevelForCluster(cluster))
        case .festival, .event:
            let targetZoom = max(mapZoomLevel, 15)
            let anchor = resolvedHologramAnchor(tapPoint: tapPoint)
            focusMap(to: pin.coordinate, zoomLevel: targetZoom)
            withAnimation(.spring(response: 0.32, dampingFraction: 0.78)) {
                hologramAnchor = anchor
                hologramPin = pin
            }
            Task {
                await viewModel.loadParkingPinsAround(pin.coordinate)
                await viewModel.loadRealtimeParkingLayer(force: true)
            }
        case .parking(let parkingLot):
            hologramPin = nil
            viewModel.selectedParkingLot = parkingLot
            focusMap(to: pin.coordinate, zoomLevel: 17)
        case .destination(let destination):
            hologramPin = nil
            focusMap(to: CLLocationCoordinate2D(latitude: destination.lat, longitude: destination.lng), zoomLevel: 16)
        case .currentLocation:
            hologramPin = nil
            focusMap(to: pin.coordinate, zoomLevel: 15)
        }
    }

    private func zoomLevelForCluster(_ cluster: MapPinCluster) -> Int {
        let centerLocation = CLLocation(latitude: cluster.coordinate.latitude, longitude: cluster.coordinate.longitude)
        let maxDistance = cluster.memberCoordinates
            .map { coordinate in
                centerLocation.distance(from: CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude))
            }
            .max() ?? 0

        let fitZoom: Int
        switch maxDistance {
        case ..<250:
            fitZoom = 15
        case ..<700:
            fitZoom = 16
        case ..<1_000:
            fitZoom = 16
        case ..<2_500:
            fitZoom = 15
        case ..<6_000:
            fitZoom = 14
        default:
            fitZoom = 13
        }
        let comfortMaxZoom = cluster.count <= 3 ? 15 : (cluster.count <= 8 ? 16 : 17)
        return min(comfortMaxZoom, max(mapZoomLevel + 1, fitZoom))
    }

    private func resolvedHologramAnchor(tapPoint: CGPoint?) -> CGPoint {
        if let tapPoint {
            return CGPoint(x: tapPoint.x, y: tapPoint.y - hologramPinTopOffset)
        }
        if mapContainerSize.width > 0 && mapContainerSize.height > 0 {
            return CGPoint(x: mapContainerSize.width / 2, y: mapContainerSize.height / 2)
        }
        return .zero
    }

    private func startHologramAnchorTracking() {
        stopHologramAnchorTracking()
        updateHologramAnchorFromProjector()
        let timer = Timer(timeInterval: 1.0 / 30.0, repeats: true) { _ in
            DispatchQueue.main.async {
                updateHologramAnchorFromProjector()
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        hologramAnchorTimer = timer
    }

    private func stopHologramAnchorTracking() {
        hologramAnchorTimer?.invalidate()
        hologramAnchorTimer = nil
    }

    private func updateHologramAnchorFromProjector() {
        guard let pin = hologramPin else { return }
        guard let point = mapProjector.screenPoint(for: pin.coordinate) else { return }
        hologramAnchor = CGPoint(x: point.x, y: point.y - hologramPinTopOffset)
    }

    private func openHologramDetail(_ pin: MapPinItem) {
        switch pin.kind {
        case .festival(let festival):
            openDiscoverResults(.festival(festival))
        case .event(let event):
            openDiscoverResults(.event(event))
        default:
            break
        }
        withAnimation(.easeOut(duration: 0.18)) {
            hologramPin = nil
        }
    }

    @ViewBuilder
    private func hologramOverlay(for pin: MapPinItem) -> some View {
        let cardWidth: CGFloat = 268
        let containerWidth = max(mapContainerSize.width, cardWidth)
        let totalHeight = hologramOverlayHeight + hologramConnectorTotalHeight
        let containerHeight = max(mapContainerSize.height, totalHeight)
        let halfWidth = cardWidth / 2
        let minX = halfWidth + 8
        let maxX = containerWidth - halfWidth - 8
        let clampedX = min(max(hologramAnchor.x, minX), maxX)
        // card는 connector 위 → bottom이 hologramAnchor.y - connectorHeight에 위치
        let preferredY = hologramAnchor.y - hologramConnectorTotalHeight - hologramOverlayHeight / 2
        let minY = hologramOverlayHeight / 2 + 60
        let maxY = containerHeight - totalHeight / 2 - 12
        let clampedY = min(max(preferredY, minY), maxY)

        Group {
            switch pin.kind {
            case .festival(let festival):
                MapHologramOverlay(
                    title: festival.title,
                    subtitle: festival.subtitle ?? festival.venueName,
                    meta: "\(festival.startDate) ~ \(festival.endDate)",
                    statusText: festival.status.displayText,
                    categoryText: festival.tags.first ?? "축제",
                    imageUrl: festival.imageUrl,
                    tint: FestivalDesign.coral,
                    symbol: "sparkles",
                    onDetails: { openHologramDetail(pin) },
                    onClose: {
                        withAnimation(.easeOut(duration: 0.18)) {
                            hologramPin = nil
                        }
                        clearMapFocus()
                    }
                )
            case .event(let event):
                MapHologramOverlay(
                    title: event.title,
                    subtitle: event.benefit ?? event.shortDescription ?? event.storeName,
                    meta: event.dateText,
                    statusText: event.timelineStatus.displayText,
                    categoryText: event.eventType,
                    imageUrl: event.imageUrl,
                    tint: FestivalDesign.teal,
                    symbol: "calendar",
                    onDetails: { openHologramDetail(pin) },
                    onClose: {
                        withAnimation(.easeOut(duration: 0.18)) {
                            hologramPin = nil
                        }
                        clearMapFocus()
                    }
                )
            default:
                EmptyView()
            }
        }
        .frame(width: cardWidth)
        .background(
            GeometryReader { geo in
                Color.clear
                    .onAppear { hologramOverlayHeight = geo.size.height }
                    .onChange(of: geo.size.height) { hologramOverlayHeight = $0 }
            }
        )
        .position(x: clampedX, y: clampedY)
    }

    @ViewBuilder
    private func hologramConnectorLayer() -> some View {
        let cardWidth: CGFloat = 268
        let containerWidth = max(mapContainerSize.width, cardWidth)
        let halfWidth = cardWidth / 2
        let clampedX = min(max(hologramAnchor.x, halfWidth + 8), containerWidth - halfWidth - 8)
        let connectorCenterY = hologramAnchor.y - hologramConnectorTotalHeight / 2

        let tint: Color = {
            switch hologramPin?.kind {
            case .festival: return FestivalDesign.coral
            case .event: return FestivalDesign.teal
            default: return FestivalDesign.teal
            }
        }()

        VStack(spacing: 0) {
            Rectangle()
                .fill(LinearGradient(
                    colors: [tint.opacity(0.35), tint.opacity(0.7)],
                    startPoint: .top,
                    endPoint: .bottom
                ))
                .frame(width: 2, height: 20)
            Circle()
                .fill(tint)
                .frame(width: 6, height: 6)
        }
        .allowsHitTesting(false)
        .position(x: clampedX, y: connectorCenterY)
    }

    private func centerOnInitialDiscoverPinIfNeeded() {
        guard !didAutoCenterOnLocation else { return }
        guard viewModel.selectedDestination == nil, viewModel.parkingLots.isEmpty else { return }
        if viewModel.showsFestivalLayer, let festival = viewModel.festivals.first {
            didAutoCenterOnLocation = true
            moveMap(to: CLLocationCoordinate2D(latitude: festival.lat, longitude: festival.lng), zoomLevel: 12)
            return
        }
        if viewModel.showsLocalEventLayer, let event = viewModel.events.first {
            didAutoCenterOnLocation = true
            moveMap(to: CLLocationCoordinate2D(latitude: event.lat, longitude: event.lng), zoomLevel: 12)
            return
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
        guard viewModel.showsFestivalLayer || viewModel.showsLocalEventLayer else { return }
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

private enum DiscoverListSort: String, CaseIterable, Identifiable {
    case distance
    case date
    case popularity

    var id: String { rawValue }

    var title: String {
        switch self {
        case .distance:
            return "\u{AC70}\u{B9AC}\u{C21C}"
        case .date:
            return "\u{B0A0}\u{C9DC}\u{C21C}"
        case .popularity:
            return "\u{C778}\u{AE30}\u{C21C}"
        }
    }
}

private struct DiscoverListItem: Identifiable {
    enum Kind {
        case festival(Festival)
        case event(FreeEvent)
    }

    let id: String
    let kind: Kind
    let title: String
    let subtitle: String
    let dateText: String
    let startDate: String
    let statusText: String
    let status: DiscoverStatus
    let distanceMeters: Int
    let imageUrl: String?
    let tint: Color
    let symbol: String
    let typeText: String
    let category: DiscoverCategory
    let sourceText: String
    let regionText: String
    let themes: [String]
    let popularityScore: Int
    let searchText: String

    static func festival(_ festival: Festival, referenceCoordinate: CLLocationCoordinate2D?) -> DiscoverListItem {
        let themes = normalizedThemes(festival.tags)
        return DiscoverListItem(
            id: "festival-\(festival.id)",
            kind: .festival(festival),
            title: festival.title,
            subtitle: festival.subtitle ?? festival.venueName ?? festival.address,
            dateText: "\(festival.startDate) - \(festival.endDate)",
            startDate: festival.startDate,
            statusText: festival.status.displayText,
            status: festival.status,
            distanceMeters: measuredDistanceMeters(
                from: referenceCoordinate,
                to: CLLocationCoordinate2D(latitude: festival.lat, longitude: festival.lng),
                fallback: festival.distanceMeters
            ),
            imageUrl: festival.imageUrl,
            tint: .purple,
            symbol: "sparkles",
            typeText: "\u{CD95}\u{C81C}",
            category: .festival,
            sourceText: festival.source,
            regionText: regionText(from: festival.address),
            themes: themes,
            popularityScore: popularityScore(hasImage: festival.imageUrl != nil, hasSourceUrl: festival.sourceUrl != nil, status: festival.status, themeCount: themes.count),
            searchText: [
                festival.title,
                festival.subtitle,
                festival.venueName,
                festival.address,
                festival.source,
                festival.tags.joined(separator: " ")
            ]
            .compactMap { $0 }
            .joined(separator: " ")
            .lowercased()
        )
    }

    static func event(_ event: FreeEvent, referenceCoordinate: CLLocationCoordinate2D?) -> DiscoverListItem {
        let themes = normalizedThemes([event.eventType])
        let category = DiscoverCategory.from(category: event.category, fallback: event.eventType, isFestival: false)
        return DiscoverListItem(
            id: "event-\(event.id)",
            kind: .event(event),
            title: event.title,
            subtitle: event.benefit ?? event.storeName,
            dateText: event.dateText,
            startDate: event.startDate,
            statusText: event.timelineStatus.displayText,
            status: event.timelineStatus,
            distanceMeters: measuredDistanceMeters(
                from: referenceCoordinate,
                to: CLLocationCoordinate2D(latitude: event.lat, longitude: event.lng),
                fallback: event.distanceMeters
            ),
            imageUrl: event.imageUrl,
            tint: category.tint,
            symbol: category.systemImage,
            typeText: category.title,
            category: category,
            sourceText: event.isSponsored ? "\(event.source) · sponsored" : event.source,
            regionText: regionText(from: event.address),
            themes: themes,
            popularityScore: popularityScore(hasImage: event.imageUrl != nil, hasSourceUrl: event.sourceUrl != nil, status: event.timelineStatus, themeCount: themes.count) + event.priorityScore,
            searchText: [
                event.title,
                event.eventType,
                event.storeName,
                event.address,
                event.source,
                event.benefit,
                event.shortDescription
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

    private static func normalizedThemes(_ values: [String]) -> [String] {
        Array(Set(values.flatMap { value in
            value
                .split(whereSeparator: { [",", "/", "|", "\u{00B7}", " "].contains(String($0)) })
                .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
        }))
        .sorted()
    }

    private static func regionText(from address: String) -> String {
        let token = address
            .split(separator: " ")
            .first
            .map(String.init) ?? "\u{C9C0}\u{C5ED} \u{C815}\u{BCF4} \u{C5C6}\u{C74C}"
        if token.hasPrefix("\u{C11C}\u{C6B8}") { return "\u{C11C}\u{C6B8}" }
        if token.hasPrefix("\u{BD80}\u{C0B0}") { return "\u{BD80}\u{C0B0}" }
        if token.hasPrefix("\u{B300}\u{AD6C}") { return "\u{B300}\u{AD6C}" }
        if token.hasPrefix("\u{C778}\u{CC9C}") { return "\u{C778}\u{CC9C}" }
        if token.hasPrefix("\u{AD11}\u{C8FC}") { return "\u{AD11}\u{C8FC}" }
        if token.hasPrefix("\u{B300}\u{C804}") { return "\u{B300}\u{C804}" }
        if token.hasPrefix("\u{C6B8}\u{C0B0}") { return "\u{C6B8}\u{C0B0}" }
        if token.hasPrefix("\u{C138}\u{C885}") { return "\u{C138}\u{C885}" }
        if token.hasPrefix("\u{ACBD}\u{AE30}") { return "\u{ACBD}\u{AE30}" }
        if token.hasPrefix("\u{AC15}\u{C6D0}") { return "\u{AC15}\u{C6D0}" }
        if token.hasPrefix("\u{CDA9}\u{BD81}") || token.hasPrefix("\u{CDA9}\u{CCAD}\u{BD81}") { return "\u{CDA9}\u{BD81}" }
        if token.hasPrefix("\u{CDA9}\u{B0A8}") || token.hasPrefix("\u{CDA9}\u{CCAD}\u{B0A8}") { return "\u{CDA9}\u{B0A8}" }
        if token.hasPrefix("\u{C804}\u{BD81}") || token.hasPrefix("\u{C804}\u{B77C}\u{BD81}") { return "\u{C804}\u{BD81}" }
        if token.hasPrefix("\u{C804}\u{B0A8}") || token.hasPrefix("\u{C804}\u{B77C}\u{B0A8}") { return "\u{C804}\u{B0A8}" }
        if token.hasPrefix("\u{ACBD}\u{BD81}") || token.hasPrefix("\u{ACBD}\u{C0C1}\u{BD81}") { return "\u{ACBD}\u{BD81}" }
        if token.hasPrefix("\u{ACBD}\u{B0A8}") || token.hasPrefix("\u{ACBD}\u{C0C1}\u{B0A8}") { return "\u{ACBD}\u{B0A8}" }
        if token.hasPrefix("\u{C81C}\u{C8FC}") { return "\u{C81C}\u{C8FC}" }
        return token
    }

    private static func popularityScore(hasImage: Bool, hasSourceUrl: Bool, status: DiscoverStatus, themeCount: Int) -> Int {
        (status == .ongoing ? 40 : 0) + (hasImage ? 30 : 0) + (hasSourceUrl ? 20 : 0) + min(themeCount, 5) * 2
    }

    var distanceText: String {
        if distanceMeters >= 1_000 {
            let kilometers = Double(distanceMeters) / 1_000
            return String(format: "%.1fkm", kilometers)
        }
        return "\(distanceMeters)m"
    }

    var isFestival: Bool {
        if case .festival = kind { return true }
        return false
    }

    var isEvent: Bool {
        if case .event = kind { return true }
        return false
    }
}

private struct DiscoverFilterState: Equatable {
    var selectedCategory: DiscoverCategory = .all
    var selectedSources: Set<String> = []
    var selectedThemes: Set<String> = []
    var selectedStatuses: Set<DiscoverStatus> = []
    var selectedRegions: Set<String> = []

    var hasDetailFilters: Bool {
        !selectedSources.isEmpty || !selectedThemes.isEmpty || !selectedStatuses.isEmpty || !selectedRegions.isEmpty
    }

    func includes(_ item: DiscoverListItem) -> Bool {
        if selectedCategory != .all && item.category != selectedCategory { return false }
        if !selectedSources.isEmpty && !selectedSources.contains(item.sourceText) { return false }
        if !selectedThemes.isEmpty && Set(item.themes).isDisjoint(with: selectedThemes) { return false }
        if !selectedStatuses.isEmpty && !selectedStatuses.contains(item.status) { return false }
        if !selectedRegions.isEmpty && !selectedRegions.contains(item.regionText) { return false }
        return true
    }
}

private enum DiscoverCategory: String, CaseIterable, Identifiable {
    case all
    case festival
    case performance
    case exhibition
    case culture
    case localEvent
    case other

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "\u{C804}\u{CCB4}"
        case .festival: return "\u{CD95}\u{C81C}"
        case .performance: return "\u{ACF5}\u{C5F0}"
        case .exhibition: return "\u{C804}\u{C2DC}"
        case .culture: return "\u{BB38}\u{D654}\u{D589}\u{C0AC}"
        case .localEvent: return "\u{C9C0}\u{C5ED}\u{D589}\u{C0AC}"
        case .other: return "\u{AE30}\u{D0C0}"
        }
    }

    var systemImage: String {
        switch self {
        case .all: return "square.grid.2x2"
        case .festival: return "sparkles"
        case .performance: return "theatermasks.fill"
        case .exhibition: return "paintpalette.fill"
        case .culture: return "calendar"
        case .localEvent: return "mappin.and.ellipse"
        case .other: return "ellipsis.circle"
        }
    }

    var tint: Color {
        switch self {
        case .all: return FestivalDesign.teal
        case .festival: return FestivalDesign.coral
        case .performance: return .pink
        case .exhibition: return .cyan
        case .culture: return FestivalDesign.teal
        case .localEvent: return FestivalDesign.lantern
        case .other: return FestivalDesign.secondaryText
        }
    }

    static func from(category: String?, fallback: String, isFestival: Bool) -> DiscoverCategory {
        if isFestival { return .festival }
        switch (category ?? fallback).lowercased() {
        case "festival": return .festival
        case "performance": return .performance
        case "exhibition": return .exhibition
        case "culture": return .culture
        case "local_event", "local-event", "local event": return .localEvent
        default: return .other
        }
    }
}

private struct MapFloatingIcon: View {
    let systemName: String
    let tint: Color
    let size: CGFloat

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: size * 0.38, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(
                ZStack {
                    Circle()
                        .fill(tint)
                    Circle()
                        .fill(
                            LinearGradient(
                                colors: [.white.opacity(0.22), .clear],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                }
            )
            .overlay(
                Circle()
                    .stroke(.white.opacity(0.85), lineWidth: 2)
            )
            .shadow(color: FestivalDesign.navy.opacity(0.22), radius: 10, y: 4)
    }
}

private struct HomeMapPillButtonStyle: ButtonStyle {
    let tint: Color
    let isFilled: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.caption.weight(.bold))
            .lineLimit(1)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(isFilled ? tint : tint.opacity(0.12))
            .foregroundStyle(isFilled ? .white : tint)
            .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.controlRadius))
            .overlay(
                RoundedRectangle(cornerRadius: FestivalDesign.controlRadius)
                    .stroke(isFilled ? .white.opacity(0.2) : tint.opacity(0.25), lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .opacity(configuration.isPressed ? 0.86 : 1)
    }
}

private struct DiscoverListPage: View {
    let items: [DiscoverListItem]
    let isLoading: Bool
    @Binding var query: String
    @Binding var sort: DiscoverListSort
    @Binding var filters: DiscoverFilterState
    let onSelect: (DiscoverListItem) -> Void
    let onShowOnMap: (DiscoverListItem.Kind) -> Void

    @State private var showsFilters = false
    @FocusState private var isQueryFocused: Bool

    private var filteredItems: [DiscoverListItem] {
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let searched = trimmedQuery.isEmpty ? items : items.filter { $0.searchText.contains(trimmedQuery) }
        return searched
            .filter { filters.includes($0) }
            .sorted(by: sortItems)
    }

    private var sources: [String] {
        uniqueValues(items.map(\.sourceText))
    }

    private var themes: [String] {
        uniqueValues(items.flatMap(\.themes))
    }

    private var regions: [String] {
        uniqueValues(items.map(\.regionText))
    }

    private var emptyStateMascotName: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "FestivalMascotNight" : "FestivalMascotJump"
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 10) {
                DiscoverMascotHeader(itemCount: filteredItems.count)

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(DiscoverCategory.allCases) { category in
                            discoverTypeChip(
                                title: category.title,
                                systemImage: category.systemImage,
                                tint: category.tint,
                                isOn: filters.selectedCategory == category
                            ) {
                                filters.selectedCategory = category
                            }
                        }
                    }
                }
                HStack(spacing: 8) {
                    Spacer(minLength: 0)
                    Menu {
                        Picker("\u{C815}\u{B82C}", selection: $sort) {
                            ForEach(DiscoverListSort.allCases) { sort in
                                Text(sort.title).tag(sort)
                            }
                        }
                    } label: {
                        Label(sort.title, systemImage: "arrow.up.arrow.down")
                            .font(.subheadline.weight(.semibold))
                    }
                    .buttonStyle(.bordered)
                    .tint(FestivalDesign.teal)
                }

                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(FestivalDesign.teal)
                    TextField(
                        "",
                        text: $query,
                        prompt: Text("\u{C774}\u{B984}, \u{C7A5}\u{C18C}, \u{C720}\u{D615} \u{AC80}\u{C0C9}")
                            .foregroundColor(FestivalDesign.secondaryText)
                    )
                        .focused($isQueryFocused)
                        .textInputAutocapitalization(.never)
                        .submitLabel(.search)
                    if !query.isEmpty {
                        Button {
                            query = ""
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(FestivalDesign.secondaryText)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 9)
                .background(FestivalDesign.surface)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(FestivalDesign.creamDeep.opacity(0.45), lineWidth: 1)
                )
            }
            .padding(14)
            .background(FestivalDesign.background)

            if filteredItems.isEmpty && !isLoading {
                VStack(spacing: 12) {
                    Image(emptyStateMascotName)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 150, height: 150)
                    Text(query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "\u{D45C}\u{C2DC}\u{D560} \u{D0D0}\u{C0C9} \u{C815}\u{BCF4}\u{AC00} \u{C5C6}\u{C2B5}\u{B2C8}\u{B2E4}" : "\u{AC80}\u{C0C9} \u{ACB0}\u{ACFC}\u{AC00} \u{C5C6}\u{C2B5}\u{B2C8}\u{B2E4}")
                        .font(.headline)
                        .foregroundStyle(FestivalDesign.navy)
                        .multilineTextAlignment(.center)
                    Text(query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "\u{C9C0}\u{B3C4}\u{B97C} \u{C870}\u{AE08} \u{C6C0}\u{C9C1}\u{C774}\u{AC70}\u{B098} \u{D544}\u{D130}\u{B97C} \u{C904}\u{C5EC}\u{BCF4}\u{C138}\u{C694}." : "\u{B2E4}\u{B978} \u{C774}\u{B984}\u{C774}\u{B098} \u{C7A5}\u{C18C}\u{B85C} \u{B2E4}\u{C2DC} \u{CC3E}\u{C544}\u{BCFC}\u{AC8C}\u{C694}.")
                        .font(.caption)
                        .foregroundStyle(FestivalDesign.secondaryText)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 28)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(FestivalDesign.background)
            } else {
                ScrollView {
                    LazyVStack(spacing: 10) {
                        ForEach(filteredItems) { item in
                            DiscoverListRow(
                                item: item,
                                onSelect: {
                                    isQueryFocused = false
                                    onSelect(item)
                                },
                                onShowOnMap: {
                                    isQueryFocused = false
                                    onShowOnMap(item.kind)
                                }
                            )
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                }
                .scrollDismissesKeyboard(.interactively)
                .simultaneousGesture(TapGesture().onEnded {
                    isQueryFocused = false
                })
                .background(FestivalDesign.background)
                .overlay(alignment: .top) {
                    if isLoading {
                        ProgressView()
                            .padding(.top, 8)
                    }
                }
            }
        }
        .festivalNavigationTitle("\u{D0D0}\u{C0C9}")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    showsFilters = true
                } label: {
                    Image(systemName: filters.hasDetailFilters ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                }
                .accessibilityLabel("\u{D544}\u{D130}")
            }
        }
        .sheet(isPresented: $showsFilters) {
            DiscoverFilterSheet(filters: $filters, sources: sources, themes: themes, regions: regions)
        }
    }

    private func discoverTypeChip(title: String, systemImage: String, tint: Color, isOn: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 11)
                .padding(.vertical, 8)
                .background(isOn ? tint.opacity(0.16) : FestivalDesign.surface)
                .foregroundStyle(isOn ? tint : FestivalDesign.secondaryText)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(isOn ? tint.opacity(0.28) : FestivalDesign.creamDeep.opacity(0.42), lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    private func sortItems(_ lhs: DiscoverListItem, _ rhs: DiscoverListItem) -> Bool {
        switch sort {
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
        case .popularity:
            if lhs.popularityScore != rhs.popularityScore {
                return lhs.popularityScore > rhs.popularityScore
            }
            if lhs.status != rhs.status {
                return lhs.status == .ongoing
            }
            return lhs.title < rhs.title
        }
    }

    private func uniqueValues(_ values: [String]) -> [String] {
        Array(Set(values.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })).sorted()
    }
}

private struct DiscoverFilterSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var filters: DiscoverFilterState
    let sources: [String]
    let themes: [String]
    let regions: [String]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    filterHero
                    filterSection(title: "주관사/출처", values: sources, selection: $filters.selectedSources)
                    filterSection(title: "축제 테마", values: themes, selection: $filters.selectedThemes)
                    statusSection
                    filterSection(title: "지역", values: regions, selection: $filters.selectedRegions)
                }
                .padding(16)
            }
            .background(FestivalDesign.background.ignoresSafeArea())
            .festivalNavigationTitle("\u{D544}\u{D130}")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("\u{CD08}\u{AE30}\u{D654}") {
                        resetFilters()
                    }
                    .foregroundStyle(FestivalDesign.coral)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("\u{C644}\u{B8CC}") {
                        dismiss()
                    }
                    .fontWeight(.semibold)
                    .foregroundStyle(FestivalDesign.teal)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var filterHero: some View {
        HStack(spacing: 12) {
            Image("FestivalMascotIcon")
                .resizable()
                .scaledToFit()
                .frame(width: 58, height: 58)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text("보고 싶은 축제만 골라볼게요")
                    .font(.headline)
                    .foregroundStyle(FestivalDesign.navy)
                Text("출처, 테마, 날짜, 지역을 조합해서 지도와 목록을 좁힙니다.")
                    .font(.subheadline)
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(
            LinearGradient(
                colors: [FestivalDesign.cream.opacity(0.9), FestivalDesign.tealSoft],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
        .overlay(
            RoundedRectangle(cornerRadius: FestivalDesign.cardRadius)
                .stroke(FestivalDesign.creamDeep.opacity(0.45), lineWidth: 1)
        )
    }

    private func filterSection(title: String, values: [String], selection: Binding<Set<String>>) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.headline)
                .foregroundStyle(FestivalDesign.navy)

            if values.isEmpty {
                Text("선택할 항목이 없습니다.")
                    .font(.subheadline)
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(FestivalDesign.cream.opacity(0.35))
                    .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.controlRadius))
            } else {
                FlowLayout(spacing: 8, rowSpacing: 8) {
                    ForEach(values, id: \.self) { value in
                        FilterChip(
                            title: value,
                            isSelected: selection.wrappedValue.contains(value),
                            tint: FestivalDesign.teal
                        ) {
                            toggle(value, in: selection)
                        }
                    }
                }
            }
        }
        .padding(14)
        .festivalCard()
    }

    private var statusSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("날짜")
                .font(.headline)
                .foregroundStyle(FestivalDesign.navy)

            HStack(spacing: 8) {
                statusChip(status: .ongoing, tint: FestivalDesign.coral)
                statusChip(status: .upcoming, tint: FestivalDesign.teal)
            }
        }
        .padding(14)
        .festivalCard()
    }

    private func statusChip(status: DiscoverStatus, tint: Color) -> some View {
        FilterChip(
            title: status.displayText,
            isSelected: filters.selectedStatuses.contains(status),
            tint: tint
        ) {
            if filters.selectedStatuses.contains(status) {
                filters.selectedStatuses.remove(status)
            } else {
                filters.selectedStatuses.insert(status)
            }
        }
    }

    private func toggle(_ value: String, in selection: Binding<Set<String>>) {
        var values = selection.wrappedValue
        if values.contains(value) {
            values.remove(value)
        } else {
            values.insert(value)
        }
        selection.wrappedValue = values
    }

    private func resetFilters() {
        filters.selectedCategory = .all
        filters.selectedSources = []
        filters.selectedThemes = []
        filters.selectedStatuses = []
        filters.selectedRegions = []
    }
}

private struct FilterChip: View {
    let title: String
    let isSelected: Bool
    let tint: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.caption2.weight(.bold))
                }
                Text(title)
                    .font(.caption.weight(.bold))
                    .lineLimit(1)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(isSelected ? tint : FestivalDesign.cream.opacity(0.38))
            .foregroundStyle(isSelected ? .white : FestivalDesign.navy)
            .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.controlRadius))
            .overlay(
                RoundedRectangle(cornerRadius: FestivalDesign.controlRadius)
                    .stroke(isSelected ? .white.opacity(0.22) : FestivalDesign.creamDeep.opacity(0.5), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}

private struct FlowLayout: Layout {
    var spacing: CGFloat
    var rowSpacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? 320
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > maxWidth {
                x = 0
                y += rowHeight + rowSpacing
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }

        return CGSize(width: maxWidth, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + rowSpacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
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

private struct ParkingPinSource: OverlayPinSource {
    let parkingLot: ParkingLot
    let prefix: String

    var id: String {
        "\(prefix)-\(parkingLot.id)"
    }

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: parkingLot.lat, longitude: parkingLot.lng)
    }
}

private enum DiscoverPinSource: OverlayPinSource {
    case festival(Festival)
    case event(FreeEvent)

    var id: String {
        switch self {
        case .festival(let festival):
            return "festival-\(festival.id)"
        case .event(let event):
            return "event-\(event.id)"
        }
    }

    var coordinate: CLLocationCoordinate2D {
        switch self {
        case .festival(let festival):
            return CLLocationCoordinate2D(latitude: festival.lat, longitude: festival.lng)
        case .event(let event):
            return CLLocationCoordinate2D(latitude: event.lat, longitude: event.lng)
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
                        .background(FestivalDesign.teal.opacity(0.16))
                        .foregroundStyle(FestivalDesign.teal)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                Text("\(parkingLot.distanceFromDestinationMeters)m")
                    .font(.caption)
                    .foregroundStyle(FestivalDesign.secondaryText)
                Spacer()
            }

            Text(parkingLot.name)
                .font(.headline)
                .foregroundStyle(FestivalDesign.navy)
                .lineLimit(2)
            HStack(spacing: 6) {
                Text("\u{CD94}\u{CC9C} \(recommendation.scorePercent)\u{C810}")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(FestivalDesign.teal)
                Text(recommendation.primaryReason)
                    .font(.caption)
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(1)
            }
            Text(parkingLot.displayStatus)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(statusColor)
            Text(parkingLot.feeSummary ?? "\u{C694}\u{AE08} \u{C815}\u{BCF4} \u{C5C6}\u{C74C}")
                .font(.caption)
                .foregroundStyle(FestivalDesign.secondaryText)
                .lineLimit(1)

            HStack {
                Button("\u{C0C1}\u{C138}") { onDetail() }
                    .buttonStyle(.bordered)
                    .tint(FestivalDesign.navy)
                    .controlSize(.small)
                Button("\u{ACBD}\u{B85C} \u{BCF4}\u{AE30}") { onNavigate() }
                    .buttonStyle(.borderedProminent)
                    .tint(FestivalDesign.teal)
                    .controlSize(.small)
            }
        }
        .padding(12)
        .frame(width: 250, alignment: .leading)
        .background(isSelected ? FestivalDesign.tealSoft : FestivalDesign.surface)
        .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
        .overlay(
            RoundedRectangle(cornerRadius: FestivalDesign.cardRadius)
                .stroke(isSelected ? FestivalDesign.teal : FestivalDesign.creamDeep.opacity(0.35), lineWidth: isSelected ? 1.5 : 1)
        )
        .shadow(color: FestivalDesign.navy.opacity(0.06), radius: 7, y: 3)
        .onTapGesture(perform: onSelect)
    }

    private var statusColor: Color {
        switch parkingLot.congestionStatus {
        case .available:
            return FestivalDesign.teal
        case .moderate:
            return FestivalDesign.lantern
        case .busy, .full:
            return FestivalDesign.coral
        case .unknown:
            return FestivalDesign.secondaryText
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
                        .foregroundStyle(FestivalDesign.navy)
                        .lineLimit(2)
                    Text(parkingLot.address)
                        .font(.caption)
                        .foregroundStyle(FestivalDesign.secondaryText)
                        .lineLimit(2)
                }
                Spacer()
                StatusBadge(
                    text: parkingLot.displayStatus,
                    kind: parkingLot.stale ? .warning : (parkingLot.realtimeAvailable ? .realtime : .neutral)
                )
            }

            HStack(spacing: 8) {
                parkingInfoPill(title: "\u{AC00}\u{B2A5}", value: parkingLot.availableSpaces.map { "\($0)\u{BA74}" } ?? "\u{C815}\u{BCF4} \u{C5C6}\u{C74C}")
                parkingInfoPill(title: "\u{C804}\u{CCB4}", value: parkingLot.totalCapacity.map { "\($0)\u{BA74}" } ?? "\u{C815}\u{BCF4} \u{C5C6}\u{C74C}")
                parkingInfoPill(title: "\u{C694}\u{AE08}", value: parkingLot.feeSummary ?? "\u{C815}\u{BCF4} \u{C5C6}\u{C74C}")
            }

            HStack {
                if parkingLot.source.hasSuffix("realtime") {
                    StatusBadge(text: "\u{C2E4}\u{C2DC}\u{AC04}", kind: .realtime)
                }
                StatusBadge(text: parkingLot.isPublic ? "\u{ACF5}\u{C601}" : "\u{C8FC}\u{CC28}\u{C7A5}", kind: .source)
                Spacer()
            }

            HStack {
                Button("\u{C9C0}\u{B3C4} \u{C5F4}\u{AE30}") { onOpenMap() }
                    .buttonStyle(.bordered)
                    .tint(FestivalDesign.navy)
                    .controlSize(.small)
                if hasDestinationContext {
                    Button("\u{C0C1}\u{C138}") { onDetail() }
                        .buttonStyle(.bordered)
                        .tint(FestivalDesign.navy)
                        .controlSize(.small)
                }
                Button("\u{ACBD}\u{B85C} \u{BCF4}\u{AE30}") { onNavigate() }
                    .buttonStyle(.borderedProminent)
                    .tint(FestivalDesign.teal)
                    .controlSize(.small)
            }
        }
        .padding(12)
        .background(FestivalDesign.surface.opacity(0.97))
        .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
        .overlay(
            RoundedRectangle(cornerRadius: FestivalDesign.cardRadius)
                .stroke(FestivalDesign.creamDeep.opacity(0.45), lineWidth: 1)
        )
        .shadow(color: FestivalDesign.navy.opacity(0.14), radius: 12, y: 6)
    }

    private func parkingInfoPill(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(FestivalDesign.secondaryText)
            Text(value)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(FestivalDesign.cream.opacity(0.42))
        .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
    }
}

private struct DiscoverMascotHeader: View {
    let itemCount: Int

    var body: some View {
        HStack(spacing: 12) {
            Image("FestivalMascotGuide")
                .resizable()
                .scaledToFit()
                .frame(width: 66, height: 66)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text("\u{C624}\u{B298} \u{AC00}\u{BCFC} \u{B9CC}\u{D55C} \u{D0D0}\u{C0C9}")
                    .font(.headline)
                    .foregroundStyle(FestivalDesign.navy)
                Text("\u{CD95}\u{C81C}\u{C640} \u{C774}\u{BCA4}\u{D2B8} \(itemCount)\u{AC1C}\u{B97C} \u{C548}\u{B0B4}\u{D560}\u{AC8C}\u{C694}.")
                    .font(.caption)
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)
            }

            Spacer(minLength: 0)
        }
        .padding(12)
        .background(
            LinearGradient(
                colors: [
                    FestivalDesign.cream.opacity(0.92),
                    FestivalDesign.tealSoft
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(FestivalDesign.creamDeep.opacity(0.45), lineWidth: 1)
        )
    }
}

private struct DiscoverListRow: View {
    let item: DiscoverListItem
    let onSelect: () -> Void
    let onShowOnMap: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            DiscoverThumbnail(imageUrl: item.imageUrl, tint: item.tint, symbol: item.symbol, size: 76)

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
                        .foregroundStyle(item.status == .ongoing ? FestivalDesign.coral : FestivalDesign.secondaryText)
                    Spacer(minLength: 0)
                    Text(item.distanceText)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(FestivalDesign.teal)
                }

                Text(item.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(FestivalDesign.navy)
                    .lineLimit(2)

                Text(item.subtitle)
                    .font(.caption)
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(1)

                Text(item.dateText)
                    .font(.caption2)
                    .foregroundStyle(FestivalDesign.secondaryText)
            }

            Button(action: onShowOnMap) {
                Image(systemName: "map")
                    .font(.caption.weight(.bold))
                    .frame(width: 32, height: 32)
                    .background(FestivalDesign.teal.opacity(0.12))
                    .foregroundStyle(FestivalDesign.teal)
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\u{C9C0}\u{B3C4}\u{C5D0}\u{C11C} \u{BCF4}\u{AE30}")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(FestivalDesign.surface)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(FestivalDesign.creamDeep.opacity(0.42), lineWidth: 1)
        )
        .shadow(color: FestivalDesign.navy.opacity(0.06), radius: 8, y: 3)
        .contentShape(Rectangle())
        .onTapGesture(perform: onSelect)
    }
}

struct DiscoverThumbnail: View {
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
        .background(
            LinearGradient(
                colors: [tint.opacity(0.15), FestivalDesign.cream.opacity(0.45)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
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
    let description: String?
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

                    HStack(spacing: 8) {
                        Text(statusText)
                            .font(.caption.weight(.bold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(tint.opacity(0.14))
                            .foregroundStyle(tint)
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                        Text(source)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(FestivalDesign.secondaryText)
                        Spacer(minLength: 0)
                    }

                    Text(title)
                        .font(.title3.weight(.bold))
                        .foregroundStyle(FestivalDesign.navy)
                        .fixedSize(horizontal: false, vertical: true)

                    if let subtitle, !subtitle.isEmpty {
                        Text(subtitle)
                            .font(.subheadline)
                            .foregroundStyle(FestivalDesign.secondaryText)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    if let description, !description.isEmpty, description != subtitle {
                        Text(description)
                            .font(.body)
                            .foregroundStyle(FestivalDesign.navy)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    DiscoverDetailMascotTip(tint: tint)

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
                        .tint(FestivalDesign.teal)

                        if let sourceUrl, let url = URL(string: sourceUrl) {
                            Button {
                                onOpenSource(url)
                            } label: {
                                Label("\u{C6D0}\u{BB38}", systemImage: "safari")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)
                            .tint(FestivalDesign.navy)
                        }
                    }

                    Spacer(minLength: 0)
                }
                .padding(18)
            }
            .festivalNavigationTitle("\u{C0C1}\u{C138} \u{C815}\u{BCF4}")
        }
        .presentationDetents([.medium, .large])
    }

    private func detailRow(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(FestivalDesign.secondaryText)
            Text(value)
                .font(.subheadline)
                .foregroundStyle(FestivalDesign.navy)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct DiscoverDetailMascotTip: View {
    let tint: Color

    var body: some View {
        HStack(spacing: 12) {
            Image("FestivalMascotGuide")
                .resizable()
                .scaledToFit()
                .frame(width: 62, height: 62)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text("\u{D589}\u{C0AC}\u{C7A5} \u{B3C4}\u{CC29}\u{AE4C}\u{C9C0} \u{AC19}\u{C774} \u{BCFC}\u{AC8C}\u{C694}")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(FestivalDesign.navy)
                Text("\u{C9C0}\u{B3C4}\u{C5D0}\u{C11C} \u{C704}\u{CE58}\u{B97C} \u{D655}\u{C778}\u{D558}\u{ACE0}, \u{D544}\u{C694}\u{D558}\u{BA74} \u{C8FC}\u{BCC0} \u{C8FC}\u{CC28}\u{B85C} \u{C774}\u{C5B4}\u{AC00}\u{C138}\u{C694}.")
                    .font(.caption)
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(12)
        .background(tint.opacity(0.10))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(tint.opacity(0.2), lineWidth: 1)
        )
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
        .background(
            LinearGradient(
                colors: [tint.opacity(0.14), FestivalDesign.cream.opacity(0.55)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var placeholder: some View {
        ZStack {
            tint.opacity(0.08)
            Image("FestivalMascotIcon")
                .resizable()
                .scaledToFit()
                .frame(width: 126, height: 126)
                .accessibilityHidden(true)
        }
    }
}
