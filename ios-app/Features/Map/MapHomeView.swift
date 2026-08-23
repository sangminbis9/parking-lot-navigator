import Combine
import CoreLocation
import Foundation
import MapKit
import SwiftUI
import UIKit

struct MapHomeView: View {
    let apiClient: APIClientProtocol
    @EnvironmentObject private var router: Router
    @EnvironmentObject private var tabRouter: AppTabRouter
    @EnvironmentObject private var destinationStore: DestinationStore
    @EnvironmentObject private var festivalFavorites: FestivalFavoritesStore
    @EnvironmentObject private var eventFavorites: LocalEventFavoritesStore
    @EnvironmentObject private var festivalFilterModel: FestivalFilterModel
    @EnvironmentObject private var themeStore: FestivalThemeStore
    @StateObject private var viewModel: MapHomeViewModel
    @StateObject private var locationProvider = CurrentLocationProvider()
    /// 진행 중 행사 핀에 넣을 대표 이미지 공급자. 로드가 끝나면 지도를 다시 그린다.
    @StateObject private var pinPhotos = MapPinPhotoStore()
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
    @State private var presentingFestivalFilter = false
    /// 레이어 토글 높이. SF Symbol마다 높이가 달라 토글이 들쭉날쭉해 보이는 걸 막는다.
    @ScaledMetric(relativeTo: .caption) private var layerToggleHeight: CGFloat = 32
    @State private var discoverListQuery = ""
    @State private var hologramPin: MapPinItem?
    @State private var eventStackCluster: MapPinCluster?
    /// 30Hz로 갱신되는 값이라 `@State`로 두면 초당 30번 지도 body 전체가 다시 평가된다.
    /// 홀로그램 카드와 커넥터만 구독하도록 별도 객체에 담는다.
    @State private var hologramAnchorModel = HologramAnchorModel()
    @State private var hologramOverlayHeight: CGFloat = 130
    /// 지도 뷰의 화면상 프레임(global). 상·하단 오버레이가 가리는 영역을 계산하는 기준.
    @State private var mapFrame: CGRect = .zero
    @State private var topOverlayMaxY: CGFloat = 0
    @State private var bottomOverlayMinY: CGFloat = .greatestFiniteMagnitude
    @State private var hologramAnchorTimer: Timer?
    @State private var mapProjector = MapProjector()
    /// 핀 파이프라인 결과 캐시. 입력이 그대로면 다시 계산하지 않는다.
    @State private var pinCache = MapPinCache()
    @State private var isSearchOverlayPresented = false
    /// 지도에서 열어본 행사 기록. 검색 화면이 검색어 없이 보여 주는 카드 목록이다.
    @StateObject private var recentDiscover = RecentDiscoverStore()
    private let overlayReleaseZoomLevel = 15
    private let discoverNameLabelZoomLevel = 17
    /// 같은 지점에 이만큼 이상 몰리면 부채꼴 분산 대신 "장소 스택" 클러스터로 묶는다.
    private let placeStackThreshold = 4
    /// 클러스터 멤버가 이 반경(m) 안에 모여 있으면 줌인해도 안 풀리는 "같은 장소"로 보고 목록 시트를 띄운다.
    private let placeStackRadiusMeters: Double = 45
    // KakaoMaps SDK가 UIImage 픽셀 크기를 pt로 취급해 렌더링
    // → screenPoint = 핀 tip(이미지 바닥). 커넥터는 원형 상단 + 여유 10pt 위에 놓는다.
    private var hologramPinTopOffset: CGFloat {
        MapPinRenderer.selectedTipToTop * MapPinRenderer.scale * UIScreen.main.scale + 4
    }
    private let hologramConnectorTotalHeight: CGFloat = 16  // 10pt bar + 6pt dot
    // 카드 폭. 최소 폭(320pt) 화면에서도 좌우 여백이 남는 값.
    private let hologramCardWidth: CGFloat = 288
    /// 클러스터를 맞출 때 핀 자체 크기·라벨이 잘리지 않도록 사방에 두는 여백(pt).
    private let clusterFitInset: CGFloat = 44

    private var mapContainerSize: CGSize { mapFrame.size }

    /// 상단 헤더·하단 컨트롤에 가리지 않고 사용자가 실제로 보는 지도 영역(지도 뷰 기준 좌표).
    private var visibleMapRect: CGRect {
        guard mapFrame.height > 0 else { return .zero }
        let top = max(0, topOverlayMaxY - mapFrame.minY)
        let bottom = max(0, mapFrame.maxY - bottomOverlayMinY)
        let height = mapFrame.height - top - bottom
        guard height > 80 else { return CGRect(origin: .zero, size: mapFrame.size) }
        return CGRect(x: 0, y: top, width: mapFrame.width, height: height)
    }

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
                selectedPinID: hologramPin?.id,
                onTap: {
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
                        .onAppear { mapFrame = proxy.frame(in: .global) }
                        .onChange(of: proxy.frame(in: .global)) { newFrame in
                            mapFrame = newFrame
                        }
                }
            )
            .overlay(alignment: .topLeading) {
                if let pin = hologramPin {
                    hologramOverlay(for: pin)
                        .transition(.scale(scale: 0.85, anchor: .bottom).combined(with: .opacity))
                }
            }

            if isInitialDiscoverLoading {
                discoverLoadingBadge
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .transition(.opacity)
            }

            VStack(spacing: 10) {
                homeMapHeader
                festivalFilterButton
                    .festivalShadow(.medium)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .padding(.horizontal, 14)
                    .background(
                        GeometryReader { proxy in
                            Color.clear
                                .onAppear { topOverlayMaxY = proxy.frame(in: .global).maxY }
                                .onChange(of: proxy.frame(in: .global)) { frame in
                                    topOverlayMaxY = frame.maxY
                                }
                        }
                    )
                VStack(spacing: 10) {
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
                    .background(
                        GeometryReader { proxy in
                            Color.clear
                                .onAppear { bottomOverlayMinY = proxy.frame(in: .global).minY }
                                .onChange(of: proxy.frame(in: .global)) { frame in
                                    bottomOverlayMinY = frame.minY
                                }
                        }
                    )
                bottomPanel
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 12)

            if isSearchOverlayPresented {
                MapSearchOverlay(
                    festivals: viewModel.festivals,
                    performances: viewModel.performances,
                    events: viewModel.events,
                    dataRevision: viewModel.pinDataRevision,
                    recents: recentDiscover.entries,
                    referenceCoordinate: locationProvider.coordinate,
                    onSelect: { item in
                        closeSearchOverlay()
                        focusMap(
                            to: CLLocationCoordinate2D(latitude: item.lat, longitude: item.lng),
                            zoomLevel: 15
                        )
                        openDiscoverResults(item: item)
                    },
                    onClearRecents: { recentDiscover.clear() },
                    onClose: { closeSearchOverlay() }
                )
                .transition(.opacity)
                .zIndex(2)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .task {
            locationProvider.request()
            await viewModel.loadInitialDiscoverLayers(viewport: mapViewport, filter: festivalFilterModel.filter)
            lastDiscoverRefreshViewport = mapViewport
            centerOnInitialDiscoverPinIfNeeded()
        }
        .onDisappear {
            discoverRefreshTask?.cancel()
            stopHologramAnchorTracking()
        }
        .sheet(isPresented: $presentingFestivalFilter) {
            FilterSheetView(filterModel: festivalFilterModel)
        }
        .sheet(item: $eventStackCluster) { cluster in
            EventStackSheet(
                items: eventStackItems(for: cluster),
                onSelect: { kind in
                    eventStackCluster = nil
                    openDiscoverResults(kind)
                }
            )
            .presentationDetents([.medium, .large])
        }
        // 필터 변경은 body diff(onChange)가 아니라 모델 publisher로 받는다.
        // 시트가 덮고 있거나 다른 탭에서 바꾼 경우에도 즉시 새로고침되도록.
        // @Published는 willSet에 값을 보내므로 모델을 다시 읽지 않고 전달된 값을 쓴다.
        .onReceive(festivalFilterModel.$filter.dropFirst()) { newFilter in
            discoverRefreshTask?.cancel()
            discoverRefreshTask = Task {
                await viewModel.loadDiscoverLayers(
                    viewport: mapViewport,
                    filter: newFilter
                )
                await MainActor.run {
                    lastDiscoverRefreshViewport = mapViewport
                }
            }
        }
        .onChange(of: hologramPin?.id) { _ in
            if hologramPin != nil {
                startHologramAnchorTracking()
            } else {
                stopHologramAnchorTracking()
            }
        }
        .onChange(of: themeStore.selectedTheme) { _ in
            // 테마가 바뀌면 핀 styleID(테마 포함)가 달라져 KakaoParkingMapView가 자동 재렌더한다.
            // 이 onChange는 body가 테마 변화를 구독하도록 의존성을 만드는 역할만 한다.
        }
        .onChange(of: themeStore.isDarkMode) { _ in
            // 위와 같은 이유. 핀 styleID에 외관이 들어가 있어 다크 모드 토글도 재렌더를 일으킨다.
        }
        .onReceive(locationProvider.$coordinate.compactMap { $0 }.prefix(1)) { coordinate in
            handleLocationUpdate(coordinate)
        }
    }

    /// 현재 위치 핀만 GPS 갱신마다 바뀐다. 나머지는 입력이 그대로면 캐시에서 그대로 꺼내 쓴다.
    private var pins: [MapPinItem] {
        var items: [MapPinItem] = []
        if let coordinate = locationProvider.coordinate {
            items.append(MapPinItem(id: "current-location", coordinate: coordinate, kind: .currentLocation))
        }
        items.append(contentsOf: cachedPins)
        return items
    }

    private var cachedPins: [MapPinItem] {
        let key = MapPinCache.PinKey(
            discover: discoverCacheKey,
            clip: discoverClipKey,
            zoomLevel: mapZoomLevel,
            selectedDiscoverPinID: selectedDiscoverPinID,
            showsRealtimeParking: viewModel.showsRealtimeParkingLayer,
            showsFreeParking: viewModel.showsFreeParkingLayer,
            discoverParkingContext: viewModel.selectedDiscoverParkingContext,
            destinationID: viewModel.selectedDestination?.id,
            photoGeneration: pinPhotos.loadedGeneration
        )
        return pinCache.pins(key) { buildPins() }
    }

    private func buildPins() -> [MapPinItem] {
        var items: [MapPinItem] = []
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
        } else if viewModel.showsFreeParkingLayer {
            items.append(contentsOf: freeParkingPins)
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
                    MapPinItem(id: "realtime-parking-\(source.parkingLot.id)", coordinate: source.coordinate, kind: .parking(source.parkingLot), parkingCongestionColored: true)
                }
            }
        }

        return groups.flatMap { group in
            group.enumerated().map { index, source in
                MapPinItem(
                    id: "realtime-parking-\(source.parkingLot.id)",
                    coordinate: overlayCoordinate(source.coordinate, index: index, count: group.count),
                    kind: .parking(source.parkingLot),
                    parkingCongestionColored: true
                )
            }
        }
    }

    private var freeParkingPins: [MapPinItem] {
        let sources = viewModel.visibleFreeParkingLots.map { RealtimeParkingPinSource(parkingLot: $0) }
        let groups = overlayGroups(sources)
        if mapZoomLevel < overlayReleaseZoomLevel {
            return groups.compactMap { group in
                if let cluster = clusterPin(for: group, idPrefix: "free-parking-cluster", tint: FestivalDesign.uiParkingBlue, isParking: true) {
                    return cluster
                }
                return group.first.map { source in
                    MapPinItem(id: "free-parking-\(source.parkingLot.id)", coordinate: source.coordinate, kind: .parking(source.parkingLot), parkingCongestionColored: true)
                }
            }
        }

        return groups.flatMap { group in
            group.enumerated().map { index, source in
                MapPinItem(
                    id: "free-parking-\(source.parkingLot.id)",
                    coordinate: overlayCoordinate(source.coordinate, index: index, count: group.count),
                    kind: .parking(source.parkingLot),
                    parkingCongestionColored: true
                )
            }
        }
    }

    /// 그룹 키를 문자열로 만들면 소스 하나마다 문자열이 하나씩 생긴다. 핀이 수백 개면 그 할당 자체가
    /// 프레임을 잡아먹으므로 셀 좌표와 분류를 정수 키로 묶는다. 정렬에 쓰는 `id`도 소스당 한 번만 만든다.
    private func overlayGroups<Source: OverlayPinSource>(_ sources: [Source]) -> [[Source]] {
        var groups: [OverlayGroupKey: [(id: String, source: Source)]] = [:]
        groups.reserveCapacity(sources.count)
        for source in sources {
            let cell = overlayCell(for: source.coordinate, zoomLevel: mapZoomLevel)
            let key = OverlayGroupKey(x: cell.x, y: cell.y, group: source.clusterGroupKey)
            groups[key, default: []].append((source.id, source))
        }
        return groups.values
            .map { $0.sorted { $0.id < $1.id } }
            .sorted { ($0.first?.id ?? "") < ($1.first?.id ?? "") }
            .map { $0.map { $0.source } }
    }

    /// 줌아웃해도 클러스터에 흡수되지 않고 개별로 유지할 선택된 핀의 id (festival/event만).
    private var selectedDiscoverPinID: String? {
        guard let pin = hologramPin else { return nil }
        switch pin.kind {
        case .festival, .event: return pin.id
        default: return nil
        }
    }

    /// 첫 탐색 데이터가 아직 없는 동안만 띄운다. 두 번째 이후 새로고침은 지도에 이미 핀이 있어 가리지 않는다.
    private var isInitialDiscoverLoading: Bool {
        viewModel.isLoadingDiscover
            && viewModel.festivals.isEmpty
            && viewModel.events.isEmpty
            && viewModel.performances.isEmpty
    }

    /// 콜드 스타트에는 응답이 수 MB라 핀이 뜨기까지 몇 초가 걸린다. 그 사이 지도가 빈 채로 있으면
    /// 멈춘 것처럼 보이므로 마스코트와 함께 진행 중임을 알린다.
    private var discoverLoadingBadge: some View {
        VStack(spacing: 10) {
            Image("FestivalMascotIcon")
                .resizable()
                .scaledToFit()
                .frame(width: 52, height: 52)
                .accessibilityHidden(true)
            ProgressView()
                .tint(FestivalDesign.coral)
            Text("이벤트를 불러오는 중이에요")
                .font(.festival(.caption, weight: .semibold))
                .foregroundStyle(FestivalDesign.navy)
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 18)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(FestivalDesign.surface)
        )
        .festivalShadow(.high)
        .allowsHitTesting(false)
    }

    private var discoverPins: [MapPinItem] {
        let sources = clippedDiscoverSources
        guard !sources.isEmpty else { return [] }

        let groups = overlayGroups(sources)
        if mapZoomLevel < overlayReleaseZoomLevel {
            let selectedID = selectedDiscoverPinID
            return groups.flatMap { group -> [MapPinItem] in
                // 선택된 핀은 클러스터에서 빼고 항상 개별 핀으로 남긴다 (구글 표준 동작).
                let clusterable = selectedID == nil ? group : group.filter { $0.id != selectedID }
                var pins: [MapPinItem] = []
                if let cluster = clusterPin(for: clusterable, idPrefix: "discover-cluster", tint: clusterable.first?.layerTint ?? FestivalDesign.uiTeal, isParking: false) {
                    pins.append(cluster)
                } else if let only = clusterable.first {
                    pins.append(mapPinItem(for: only, coordinate: only.coordinate))
                }
                if let selectedID, let selected = group.first(where: { $0.id == selectedID }) {
                    pins.append(mapPinItem(for: selected, coordinate: selected.coordinate))
                }
                return pins
            }
        }

        // 줌인 상태: 같은 지점에 4개 이상 몰리면 부채꼴 분산 대신 "장소 스택" 클러스터로 묶는다.
        // (줌인해도 좌표가 같아 안 풀리는 다수 이벤트 → 탭 시 목록 시트로 푼다.)
        let selectedID = selectedDiscoverPinID
        return groups.flatMap { group -> [MapPinItem] in
            let clusterable = selectedID == nil ? group : group.filter { $0.id != selectedID }
            var pins: [MapPinItem] = []
            if clusterable.count >= placeStackThreshold,
               let cluster = clusterPin(for: clusterable, idPrefix: "discover-stack", tint: clusterable.first?.layerTint ?? FestivalDesign.uiTeal, isParking: false) {
                pins.append(cluster)
            } else {
                for (index, source) in clusterable.enumerated() {
                    pins.append(mapPinItem(
                        for: source,
                        coordinate: overlayCoordinate(source.coordinate, index: index, count: clusterable.count)
                    ))
                }
            }
            if let selectedID, let selected = group.first(where: { $0.id == selectedID }) {
                pins.append(mapPinItem(for: selected, coordinate: selected.coordinate))
            }
            return pins
        }
    }

    /// 지도 상단 토글 색의 UIKit 버전. 외관(라이트/다크)에 따라 풀리므로 계산 프로퍼티여야 한다.
    private static var tradeExpoTint: UIColor { FestivalDesign.ui(FestivalPrimaryCategory.tradeExpo.tint) }
    private static var performanceTint: UIColor { FestivalDesign.ui(FestivalPrimaryCategory.musicPerformance.tint) }

    /// discover 핀 소스를 만드는 입력들. 이게 그대로면 소스를 다시 만들 필요가 없다.
    private var discoverCacheKey: MapPinCache.DiscoverKey {
        MapPinCache.DiscoverKey(
            revision: viewModel.pinDataRevision,
            showsFestival: viewModel.showsFestivalLayer,
            showsTradeExpo: viewModel.showsTradeExpoLayer,
            showsLocalEvent: viewModel.showsLocalEventLayer,
            showsPerformance: viewModel.showsPerformanceLayer,
            filter: festivalFilterModel.filter,
            theme: themeStore.selectedTheme,
            isDarkMode: themeStore.isDarkMode
        )
    }

    /// 한 번의 body 평가 안에서도 핀 파이프라인과 하단 패널이 각각 부른다. 캐시로 한 번만 만든다.
    private var discoverSources: [DiscoverPinSource] {
        pinCache.discoverSources(discoverCacheKey) { buildDiscoverSources() }
    }

    private func buildDiscoverSources() -> [DiscoverPinSource] {
        var sources: [DiscoverPinSource] = []
        // KOPIS 행은 /api/festivals에서 Festival로, /api/performances에서 FreeEvent로 같은 id를 달고 두 번 온다.
        // 타입별로 따로 세면 핀이 두 개 찍히므로 id 하나로 합쳐 센다(id는 source 접두어가 있어 충돌하지 않는다).
        var seenIds: Set<String> = []

        // 공연을 먼저 담아, 공연으로도 축제로도 오는 항목이 공연 색을 갖게 한다.
        if viewModel.showsPerformanceLayer {
            for item in viewModel.performances {
                switch item {
                case .festival(let f) where festivalFilterModel.filter.matches(f) && seenIds.insert(f.id).inserted:
                    sources.append(.festival(f, layerTint: Self.performanceTint))
                case .event(let e) where seenIds.insert(e.id).inserted:
                    sources.append(.event(e, layerTint: Self.performanceTint))
                default:
                    break
                }
            }
        }
        // 축제 응답에는 산업·박람회(trade_expo)가 섞여 오므로 토글별로 갈라 담는다.
        for f in viewModel.festivals {
            let isTradeExpo = f.primaryCategory == .tradeExpo
            guard isTradeExpo ? viewModel.showsTradeExpoLayer : viewModel.showsFestivalLayer else { continue }
            guard seenIds.insert(f.id).inserted else { continue }
            sources.append(.festival(f, layerTint: isTradeExpo ? Self.tradeExpoTint : FestivalDesign.uiCoral))
        }
        if viewModel.showsLocalEventLayer {
            for e in viewModel.events where seenIds.insert(e.id).inserted {
                sources.append(.event(e, layerTint: FestivalDesign.uiTeal))
            }
        }
        return sources
    }

    /// 핀 파이프라인에 넣을 소스의 상한. 지도가 처음 뜰 때는 아직 카메라 이벤트가 없어
    /// 뷰포트 반경이 초기값(20km)이라 반경 컷만으로는 콜드 스타트 부하가 줄지 않는다.
    /// 가까운 순으로 이만큼만 남겨 어떤 상황에서도 한 번에 그리는 양을 묶어 둔다.
    private static let maxPinSourceCount = 600

    /// 핀으로 만들 소스를 화면 주변으로 잘라내는 반경. 살짝 밀어도 핀이 비지 않도록 여유를 준다.
    private var pinClipRadiusMeters: Int {
        max(Int(Double(mapViewport.radiusMeters) * 1.35), 3_000)
    }

    private var discoverClipKey: MapPinCache.ClipKey {
        MapPinCache.ClipKey(
            discover: discoverCacheKey,
            centerLat: mapViewport.center.latitude,
            centerLng: mapViewport.center.longitude,
            radiusMeters: pinClipRadiusMeters,
            selectedDiscoverPinID: selectedDiscoverPinID
        )
    }

    /// 핀 파이프라인에 넣을 소스. 20km 반경 응답은 서울 기준 3,000건이 넘어서,
    /// 화면 밖까지 전부 클러스터링하고 핀 사진까지 받으면 콜드 스타트에 지도가 몇 초씩 멈춘다.
    /// 보이는 영역(+여유)만 남긴다. 선택된 핀은 화면 밖으로 밀려도 유지한다.
    private var clippedDiscoverSources: [DiscoverPinSource] {
        pinCache.clippedDiscoverSources(discoverClipKey) {
            let sources = discoverSources
            guard !sources.isEmpty else { return [] }
            let selectedID = selectedDiscoverPinID
            let centerLat = mapViewport.center.latitude
            let centerLng = mapViewport.center.longitude
            let radius = Double(pinClipRadiusMeters)
            // 수천 건에 CLLocation.distance를 쓰면 객체 할당만으로 프레임을 넘긴다.
            // 이 규모에서는 평면 근사로 충분하다.
            let metersPerLat = 111_320.0
            let metersPerLng = 111_320.0 * cos(centerLat * .pi / 180)
            let limit = radius * radius
            var scored: [(source: DiscoverPinSource, distanceSquared: Double)] = []
            scored.reserveCapacity(min(sources.count, Self.maxPinSourceCount))
            for source in sources {
                if let selectedID, source.id == selectedID {
                    scored.append((source, -1))
                    continue
                }
                let dy = (source.coordinate.latitude - centerLat) * metersPerLat
                let dx = (source.coordinate.longitude - centerLng) * metersPerLng
                let distanceSquared = dx * dx + dy * dy
                if distanceSquared <= limit { scored.append((source, distanceSquared)) }
            }
            guard scored.count > Self.maxPinSourceCount else { return scored.map(\.source) }
            return scored.sorted { $0.distanceSquared < $1.distanceSquared }
                .prefix(Self.maxPinSourceCount)
                .map(\.source)
        }
    }

    private var visibleDiscoverSources: [DiscoverPinSource] {
        let key = MapPinCache.ViewportKey(
            discover: discoverCacheKey,
            centerLat: mapViewport.center.latitude,
            centerLng: mapViewport.center.longitude,
            radiusMeters: mapViewport.radiusMeters
        )
        return pinCache.visibleDiscoverSources(key) {
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
    }

    // discoverItemCount / firstDiscoverListItem는 homeDiscoveryPanel 내부로 통합
    // — visibleDiscoverSources(CLLocation 계산 포함)가 한 render에 2회 이상 호출되는 것을 방지

    private func mapPinItem(for source: DiscoverPinSource, coordinate: CLLocationCoordinate2D) -> MapPinItem {
        switch source {
        case .festival(let festival, let tint):
            let live = festival.status == .ongoing
            return MapPinItem(
                id: "festival-\(festival.id)",
                coordinate: coordinate,
                kind: .festival(festival),
                showsTitleLabel: mapZoomLevel >= discoverNameLabelZoomLevel,
                layerTint: tint,
                isLive: live,
                // 대표 이미지는 진행 중 행사만 붙인다. 이미지 유무와 LIVE 라벨이 함께 "지금 하는 행사"를 알린다.
                // imageUrl이 비고 imageUrls에만 이미지가 있는 행이 있어 상세 화면과 같은 순서로 fallback한다.
                photo: live ? pinPhotos.photo(for: festival.imageUrl ?? festival.imageUrls.first) : nil
            )
        case .event(let event, let tint):
            let live = event.timelineStatus == .ongoing
            return MapPinItem(
                id: "event-\(event.id)",
                coordinate: coordinate,
                kind: .event(event),
                showsTitleLabel: mapZoomLevel >= discoverNameLabelZoomLevel,
                layerTint: tint,
                isLive: live,
                photo: live ? pinPhotos.photo(for: event.imageUrl ?? event.imageUrls.first) : nil
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
        // 같은 셀에 분류가 여럿이면 overlayKey와 count가 겹쳐 id가 충돌한다. 분류 키를 섞어 가른다.
        let groupKey = group.first?.clusterGroupKey ?? 0
        let cluster = MapPinCluster(
            id: "\(idPrefix)-\(overlayKey(for: center, zoomLevel: mapZoomLevel))\(groupKey == 0 ? "" : "-\(groupKey)")-\(group.count)",
            coordinate: center,
            count: group.count,
            memberCoordinates: coordinates,
            memberIDs: group.map(\.id),
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

    private func overlayCell(for coordinate: CLLocationCoordinate2D, zoomLevel: Int) -> (x: Int, y: Int) {
        let point = mercatorPoint(for: coordinate, zoomLevel: zoomLevel)
        let cellSize = zoomLevel < overlayReleaseZoomLevel ? 30.0 : 14.0
        return (Int((point.x / cellSize).rounded()), Int((point.y / cellSize).rounded()))
    }

    private func overlayKey(for coordinate: CLLocationCoordinate2D, zoomLevel: Int) -> String {
        let cell = overlayCell(for: coordinate, zoomLevel: zoomLevel)
        return "\(cell.x):\(cell.y)"
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
            locationPermissionNotice
        }
        .padding(.horizontal, 14)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .background(FestivalDesign.barSurface.opacity(0.98))
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(FestivalDesign.barBorder)
                .frame(height: 1)
        }
        .festivalShadow(.medium)
    }

    private var isLocationDenied: Bool {
        locationProvider.authorizationStatus == .denied || locationProvider.authorizationStatus == .restricted
    }

    private func openLocationSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }

    /// 권한이 없으면 지도는 서울에서 시작한다. 그 사실을 감추지 않고 해결 경로를 같이 준다.
    @ViewBuilder
    private var locationPermissionNotice: some View {
        if isLocationDenied {
            HStack(spacing: 8) {
                Image(systemName: "location.slash")
                    .font(.festival(.caption, weight: .bold))
                    .foregroundStyle(FestivalDesign.coralText)
                Text("위치 권한이 꺼져 있어 서울 기준으로 보고 있어요")
                    .font(.festival(.caption, weight: .semibold))
                    .foregroundStyle(FestivalDesign.navy)
                    .lineLimit(2)
                Spacer(minLength: 0)
                Button("설정 열기") {
                    openLocationSettings()
                }
                .font(.festival(.caption, weight: .bold))
                .buttonStyle(.plain)
                .foregroundStyle(FestivalDesign.tealText)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(FestivalDesign.cream.opacity(0.7))
            .clipShape(FestivalDesign.controlShape)
        }
    }

    /// 검색 바는 자리만 지키고, 실제 입력은 같은 위치에서 열리는 검색 화면이 받는다.
    private var searchPanel: some View {
        Button {
            withAnimation(.easeOut(duration: FestivalDesign.Motion.standard)) {
                isSearchOverlayPresented = true
            }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .font(.festival(.subheadline, weight: .semibold))
                    .foregroundStyle(FestivalDesign.tealText)
                Text("행사, 가게 이벤트 검색")
                    .font(.festival(.subheadline))
                    .foregroundStyle(FestivalDesign.secondaryText)
                Spacer(minLength: 0)
            }
            .frame(height: 34)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
            .background(FestivalDesign.surface)
            .clipShape(FestivalDesign.controlShape)
            .overlay(
                FestivalDesign.controlShape
                    .stroke(FestivalDesign.creamDeep.opacity(0.45), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("검색")
    }

    private func closeSearchOverlay() {
        withAnimation(.easeOut(duration: FestivalDesign.Motion.standard)) {
            isSearchOverlayPresented = false
        }
    }

    private var discoverLayerToggles: some View {
        VStack(alignment: .leading, spacing: 7) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 7) {
                    layerToggle(
                        title: "\u{CD95}\u{C81C}",
                        systemImage: "sparkles",
                        tint: FestivalDesign.coral,
                        // 코랄 채움 위 대비가 3:1에 못 미쳐 자동 판정은 진한 잉크를 고르지만,
                        // 디자인상 축제 토글은 흰 글자·기호가 맞다.
                        onFill: .white,
                        isOn: viewModel.showsFestivalLayer
                    ) {
                        Task { await viewModel.setFestivalLayerVisible(!viewModel.showsFestivalLayer, viewport: mapViewport, filter: festivalFilterModel.filter) }
                    }
                    layerToggle(
                        title: "\u{AC00}\u{AC8C} \u{C774}\u{BCA4}\u{D2B8}",
                        systemImage: "tag.fill",
                        tint: FestivalDesign.teal,
                        isOn: viewModel.showsLocalEventLayer
                    ) {
                        Task { await viewModel.setLocalEventLayerVisible(!viewModel.showsLocalEventLayer, viewport: mapViewport) }
                    }
                    layerToggle(
                        title: "공연",
                        systemImage: "music.note",
                        tint: FestivalPrimaryCategory.musicPerformance.tint,
                        isOn: viewModel.showsPerformanceLayer
                    ) {
                        Task { await viewModel.setPerformanceLayerVisible(!viewModel.showsPerformanceLayer, viewport: mapViewport) }
                    }
                    layerToggle(
                        title: "박람회",
                        systemImage: FestivalPrimaryCategory.tradeExpo.systemImage,
                        tint: FestivalPrimaryCategory.tradeExpo.tint,
                        isOn: viewModel.showsTradeExpoLayer
                    ) {
                        Task { await viewModel.setTradeExpoLayerVisible(!viewModel.showsTradeExpoLayer, viewport: mapViewport, filter: festivalFilterModel.filter) }
                    }
                    if viewModel.isLoadingDiscover || viewModel.isLoadingRealtimeParking {
                        ProgressView()
                            .controlSize(.small)
                            .padding(.horizontal, 4)
                    }
                }
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 7) {
                    layerToggle(
                        title: "실시간 주차",
                        systemImage: "parkingsign.circle.fill",
                        tint: FestivalDesign.parkingBlue,
                        isOn: viewModel.showsRealtimeParkingLayer
                    ) {
                        Task { await viewModel.setRealtimeParkingLayerVisible(!viewModel.showsRealtimeParkingLayer, viewport: mapViewport) }
                    }
                    layerToggle(
                        title: "무료 주차장",
                        systemImage: "gift.fill",
                        tint: FestivalDesign.lantern,
                        isOn: viewModel.showsFreeParkingLayer
                    ) {
                        Task { await viewModel.setFreeParkingLayerVisible(!viewModel.showsFreeParkingLayer, viewport: mapViewport) }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var festivalFilterButton: some View {
        Button {
            presentingFestivalFilter = true
        } label: {
            Label("필터", systemImage: "line.3.horizontal.decrease.circle")
                .font(.festival(.caption, weight: .bold))
                .lineLimit(1)
                .padding(.horizontal, 10)
                .frame(height: layerToggleHeight)
                // 지도 위에 떠 있어 반투명하면 타일이 비친다. 불투명 surface를 깔고 적용 상태 틴트를 얹는다.
                .background(festivalFilterModel.filter.isEmpty ? Color.clear : FestivalDesign.coral.opacity(0.15))
                .background(FestivalDesign.surface)
                .foregroundStyle(festivalFilterModel.filter.isEmpty
                                 ? FestivalDesign.secondaryText
                                 : FestivalDesign.coralText)
                .clipShape(FestivalDesign.controlShape)
                .overlay(
                    FestivalDesign.controlShape
                        .stroke(festivalFilterModel.filter.isEmpty
                                ? FestivalDesign.creamDeep.opacity(0.45)
                                : FestivalDesign.coral.opacity(0.5), lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("축제 필터")
        // 적용 여부가 색으로만 드러나므로 보이스오버에도 상태를 알린다.
        .accessibilityValue(festivalFilterModel.filter.isEmpty ? "미적용" : "적용됨")
    }

    private func layerToggle(
        title: String,
        systemImage: String,
        tint: Color,
        onFill: Color? = nil,
        isOn: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(.festival(.caption, weight: .bold))
                .lineLimit(1)
                .padding(.horizontal, 10)
                .frame(height: layerToggleHeight)
                .background(isOn ? tint : FestivalDesign.surface.opacity(0.92))
                .foregroundStyle(isOn ? (onFill ?? FestivalDesign.onFill(tint)) : FestivalDesign.secondaryText)
                .clipShape(FestivalDesign.controlShape)
                .overlay(
                    FestivalDesign.controlShape
                        .stroke(isOn ? Color.clear : FestivalDesign.creamDeep.opacity(0.45), lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
        .accessibilityValue(isOn ? "\u{CF1C}\u{C9D0}" : "\u{AEBC}\u{C9D0}")
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
                    } else if isLocationDenied {
                        // 권한이 막힌 상태에서 request()는 아무 일도 하지 않아 버튼이 고장난 것처럼 보인다.
                        openLocationSettings()
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
        let sources = visibleDiscoverSources
        let itemCount = sources.count
        let ref = locationProvider.coordinate
        let firstItem: DiscoverListItem? = {
            switch sources.first {
            case .festival(let f, _): return .festival(f, referenceCoordinate: ref)
            case .event(let e, _): return .event(e, referenceCoordinate: ref)
            case nil: return nil
            }
        }()
        return ZStack(alignment: .topTrailing) {
            HStack(spacing: 12) {
                Image("FestivalMascotGuide")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 64, height: 64)
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Text("주변 축제부터 둘러보세요")
                            .font(.festival(.headline))
                            .foregroundStyle(FestivalDesign.navy)
                        Text("\(itemCount)")
                            .font(.festival(.caption, weight: .bold))
                            .foregroundStyle(FestivalDesign.tealText)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(FestivalDesign.tealSoft)
                            .clipShape(FestivalDesign.controlShape)
                            .accessibilityLabel("현재 지도 기준 주변 이벤트와 축제 \(itemCount)개")
                    }
                    Text("마음에 드는 장소를 고르면 근처 주차장까지 이어서 안내합니다.")
                        .font(.festival(.caption))
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
                            if let first = firstItem {
                                openDiscoverResults(first.kind)
                            }
                        } label: {
                            Label("추천 보기", systemImage: "mappin.and.ellipse")
                        }
                        .buttonStyle(HomeMapPillButtonStyle(tint: FestivalDesign.coral, isFilled: false))
                        .disabled(itemCount == 0)
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
                    .font(.festival(.caption, weight: .bold))
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .frame(width: 28, height: 28)
                    .background(FestivalDesign.cream.opacity(0.55))
                    .clipShape(Circle())
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("안내 카드 닫기")
        }
        .background(FestivalDesign.surface.opacity(0.97))
        .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
        .overlay(
            RoundedRectangle(cornerRadius: FestivalDesign.cardRadius)
                .stroke(FestivalDesign.creamDeep.opacity(0.5), lineWidth: 1)
        )
        .festivalShadow(.high)
    }

    private func standaloneParkingPanel(parkingLot: ParkingLot) -> some View {
        StandaloneParkingMapCard(
            parkingLot: parkingLot,
            onOpenMap: {
                openMaps(name: parkingLot.name, latitude: parkingLot.lat, longitude: parkingLot.lng)
            },
            onDetail: {
                router.showDetail(
                    destination: viewModel.selectedDestination ?? parkingLot.asDestination,
                    parkingLot: parkingLot
                )
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
                            .font(.festival(.headline))
                            .foregroundStyle(FestivalDesign.navy)
                        Text(destination.address)
                            .font(.festival(.caption))
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
                        .font(.festival(.subheadline))
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
            .festivalShadow(.high)
        }
    }

    private func inlineError(_ message: String) -> some View {
        Text(message)
            .font(.festival(.subheadline))
            .foregroundStyle(FestivalDesign.onFill(FestivalDesign.coral))
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

    /// 핀이 화면 세로 2/3 지점(아래쪽)에 오도록 카메라 중심을 핀보다 북쪽으로 이동시킨다.
    /// 위쪽 1/3 공간은 홀로그램 카드가 차지한다.
    private func focusMapBelowCenter(to coordinate: CLLocationCoordinate2D, zoomLevel: Int) {
        let height = mapContainerSize.height
        guard height > 0 else {
            focusMap(to: coordinate, zoomLevel: zoomLevel)
            return
        }
        // center는 y=H/2에 렌더링되고, 핀을 y=2/3·H에 두려면 center를 위(북쪽)로 H/6만큼 올린다.
        let metersPerPixel = 156_543.033_92 * cos(coordinate.latitude * .pi / 180) / pow(2.0, Double(zoomLevel))
        let offsetMeters = Double(height / 6.0) * metersPerPixel
        let latOffset = offsetMeters / 111_320.0
        let shifted = CLLocationCoordinate2D(
            latitude: coordinate.latitude + latOffset,
            longitude: coordinate.longitude
        )
        focusMap(to: shifted, zoomLevel: zoomLevel)
    }

    /// 상·하단 오버레이에 가리지 않는 영역 한가운데에 좌표가 오도록 카메라를 옮긴다.
    /// 카메라 중심은 지도 뷰 정중앙에 그려지므로, 가시 영역 중심과의 차이만큼 중심을 북/남으로 민다.
    private func focusMapInVisibleArea(to coordinate: CLLocationCoordinate2D, zoomLevel: Int) {
        let visible = visibleMapRect
        guard visible.height > 0, mapFrame.height > 0 else {
            focusMap(to: coordinate, zoomLevel: zoomLevel)
            return
        }
        // 가시 영역 중심이 지도 뷰 중심보다 아래면(양수) 좌표를 그만큼 아래에 그려야 하므로 중심을 북쪽으로 올린다.
        let offsetPixels = visible.midY - mapFrame.height / 2
        guard abs(offsetPixels) > 1 else {
            focusMap(to: coordinate, zoomLevel: zoomLevel)
            return
        }
        let metersPerPixel = 156_543.033_92 * cos(coordinate.latitude * .pi / 180) / pow(2.0, Double(zoomLevel))
        let latOffset = Double(offsetPixels) * metersPerPixel / 111_320.0
        focusMap(
            to: CLLocationCoordinate2D(latitude: coordinate.latitude + latOffset, longitude: coordinate.longitude),
            zoomLevel: zoomLevel
        )
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

    /// 장소 스택 클러스터의 멤버 id로 해당 축제/이벤트를 찾아 목록 시트용 아이템을 만든다.
    private func eventStackItems(for cluster: MapPinCluster) -> [DiscoverListItem] {
        let ref = locationProvider.coordinate
        let byID = Dictionary(discoverSources.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return cluster.memberIDs.compactMap { id -> DiscoverListItem? in
            switch byID[id] {
            case .festival(let festival, _): return .festival(festival, referenceCoordinate: ref)
            case .event(let event, _): return .event(event, referenceCoordinate: ref)
            case nil: return nil
            }
        }
    }

    private func openDiscoverResults(_ kind: DiscoverListItem.Kind) {
        switch kind {
        case .festival(let festival):
            recentDiscover.add(.festival(festival))
            destinationStore.addRecent(festival.discoverDestination)
            router.showResults(for: festival.discoverDestination, presentation: festival.discoverPresentation)
        case .event(let event):
            recentDiscover.add(.event(event))
            destinationStore.addRecent(event.discoverDestination)
            router.showResults(for: event.discoverDestination, presentation: event.discoverPresentation)
        }
    }

    private func openDiscoverResults(item: DiscoverTabItem) {
        switch item.kind {
        case .festival(let festival): openDiscoverResults(.festival(festival))
        case .event(let event): openDiscoverResults(.event(event))
        }
    }

    private func handleMapBackgroundTap() {
        // 1차 탭: 홀로그램이 떠 있으면 홀로그램만 끄고 주변 주차장은 유지
        if hologramPin != nil {
            withAnimation(.easeOut(duration: FestivalDesign.Motion.standard)) {
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
            // 같은 장소에 몰린 discover 스택은 줌인해도 안 풀리므로 목록 시트로 푼다.
            if !cluster.isParking, maxMemberDistance(cluster) <= placeStackRadiusMeters {
                eventStackCluster = cluster
            } else {
                viewModel.selectedParkingLot = nil
                focusMapInVisibleArea(
                    to: clusterBoundsCenter(cluster),
                    zoomLevel: zoomLevelForCluster(cluster)
                )
            }
        case .festival, .event:
            let targetZoom = max(mapZoomLevel, 15)
            let anchor = resolvedHologramAnchor(tapPoint: tapPoint)
            focusMapBelowCenter(to: pin.coordinate, zoomLevel: targetZoom)
            withAnimation(FestivalDesign.Motion.spring) {
                hologramAnchorModel.point = anchor
                hologramPin = pin
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

    /// 클러스터 중심에서 가장 먼 멤버까지의 거리(m). 0이면 모든 멤버가 같은 좌표.
    private func maxMemberDistance(_ cluster: MapPinCluster) -> Double {
        let center = CLLocation(latitude: cluster.coordinate.latitude, longitude: cluster.coordinate.longitude)
        return cluster.memberCoordinates
            .map { center.distance(from: CLLocation(latitude: $0.latitude, longitude: $0.longitude)) }
            .max() ?? 0
    }

    /// 멤버 좌표를 감싸는 사각형의 중심. 평균보다 화면 맞춤에 가깝다.
    private func clusterBoundsCenter(_ cluster: MapPinCluster) -> CLLocationCoordinate2D {
        let coordinates = cluster.memberCoordinates
        guard let first = coordinates.first else { return cluster.coordinate }
        let lats = coordinates.map(\.latitude)
        let lngs = coordinates.map(\.longitude)
        guard let minLat = lats.min(), let maxLat = lats.max(),
              let minLng = lngs.min(), let maxLng = lngs.max() else { return first }
        return CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLng + maxLng) / 2)
    }

    /// 멤버 전체가 "가려지지 않은" 지도 영역 안에 들어오는 가장 확대된 줌 레벨.
    private func zoomLevelForCluster(_ cluster: MapPinCluster) -> Int {
        let comfortMaxZoom = cluster.count <= 3 ? 15 : (cluster.count <= 8 ? 16 : 17)
        let coordinates = cluster.memberCoordinates
        let visible = visibleMapRect
        guard coordinates.count > 1, visible.width > 0, visible.height > 0 else {
            return max(mapZoomLevel + 1, comfortMaxZoom)
        }
        let usableWidth = max(40, Double(visible.width - clusterFitInset * 2))
        let usableHeight = max(40, Double(visible.height - clusterFitInset * 2))

        for zoom in stride(from: comfortMaxZoom, through: 6, by: -1) {
            let points = coordinates.map { mercatorPoint(for: $0, zoomLevel: zoom) }
            let xs = points.map(\.x)
            let ys = points.map(\.y)
            guard let minX = xs.min(), let maxX = xs.max(),
                  let minY = ys.min(), let maxY = ys.max() else { break }
            if Double(maxX - minX) <= usableWidth && Double(maxY - minY) <= usableHeight {
                return zoom
            }
        }
        return 6
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
        let anchor = CGPoint(x: point.x, y: point.y - hologramPinTopOffset)
        // 지도가 멈춰 있으면 값이 같다. 같은 값을 다시 쓰면 카드가 헛되이 다시 그려진다.
        guard anchor != hologramAnchorModel.point else { return }
        hologramAnchorModel.point = anchor
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
        withAnimation(.easeOut(duration: FestivalDesign.Motion.standard)) {
            hologramPin = nil
        }
    }

    @ViewBuilder
    private func hologramOverlay(for pin: MapPinItem) -> some View {
        // 위치 계산만 앵커를 구독하는 자식으로 내린다. 카드 내용은 지도 body가 바뀔 때만 다시 만든다.
        HologramAnchoredCard(
            anchor: hologramAnchorModel,
            cardWidth: hologramCardWidth,
            containerSize: mapContainerSize,
            connectorHeight: hologramConnectorTotalHeight,
            overlayHeight: hologramOverlayHeight
        ) {
            Group {
                switch pin.kind {
                case .festival(let festival):
                    MapHologramOverlay(
                        title: festival.title,
                        subtitle: festival.subtitle ?? festival.venueName,
                        meta: "\(festival.startDate) ~ \(festival.endDate)",
                        status: festival.status,
                        tags: festival.discoverTags,
                        imageUrl: festival.primaryImageUrl,
                        tint: Color(pin.layerTint ?? FestivalDesign.uiCoral),
                        symbol: "sparkles",
                        isFavorite: festivalFavorites.contains(id: festival.id),
                        onToggleFavorite: { festivalFavorites.toggle(festival) },
                        shareContent: festival.shareContent,
                        onDetails: { openHologramDetail(pin) },
                        onClose: {
                            withAnimation(.easeOut(duration: FestivalDesign.Motion.standard)) {
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
                        status: event.timelineStatus,
                        tags: event.discoverTags,
                        imageUrl: event.primaryImageUrl,
                        tint: Color(pin.layerTint ?? FestivalDesign.uiTeal),
                        symbol: "calendar",
                        isFavorite: eventFavorites.contains(id: event.id),
                        onToggleFavorite: { eventFavorites.toggle(event) },
                        shareContent: event.shareContent,
                        isSponsored: event.isSponsored,
                        onDetails: { openHologramDetail(pin) },
                        onClose: {
                            withAnimation(.easeOut(duration: FestivalDesign.Motion.standard)) {
                                hologramPin = nil
                            }
                            clearMapFocus()
                        }
                    )
                default:
                    EmptyView()
                }
            }
            .frame(width: hologramCardWidth)
            .background(
                GeometryReader { geo in
                    Color.clear
                        .onAppear { hologramOverlayHeight = geo.size.height }
                        .onChange(of: geo.size.height) { hologramOverlayHeight = $0 }
                }
            )
        }
    }

    private func hologramConnectorLayer() -> some View {
        let tint: Color = {
            switch hologramPin?.kind {
            case .festival: return FestivalDesign.coral
            case .event: return FestivalDesign.teal
            default: return FestivalDesign.teal
            }
        }()

        return HologramConnectorLayer(
            anchor: hologramAnchorModel,
            cardWidth: hologramCardWidth,
            containerWidth: mapContainerSize.width,
            connectorHeight: hologramConnectorTotalHeight,
            tint: tint
        )
    }

    private func centerOnInitialDiscoverPinIfNeeded() {
        guard !didAutoCenterOnLocation else { return }
        guard viewModel.selectedDestination == nil, viewModel.parkingLots.isEmpty else { return }
        if viewModel.showsFestivalLayer || viewModel.showsTradeExpoLayer, let festival = viewModel.festivals.first {
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
        let discoverLayersActive = viewModel.showsFestivalLayer || viewModel.showsTradeExpoLayer || viewModel.showsLocalEventLayer || viewModel.showsPerformanceLayer
        let freeParkingActive = viewModel.showsFreeParkingLayer
        guard discoverLayersActive || freeParkingActive else { return }
        guard shouldRefreshDiscover(for: viewport) else { return }
        discoverRefreshTask?.cancel()
        discoverRefreshTask = Task {
            try? await Task.sleep(nanoseconds: 650_000_000)
            guard !Task.isCancelled else { return }
            if discoverLayersActive {
                await viewModel.loadDiscoverLayers(viewport: viewport, filter: festivalFilterModel.filter)
            }
            if freeParkingActive {
                await viewModel.loadStaticFreeParkingLots(viewport: viewport)
            }
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
            imageUrl: festival.primaryImageUrl,
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
            imageUrl: event.primaryImageUrl,
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
            .font(.festival(size: size * 0.38, weight: .bold))
            .foregroundStyle(FestivalDesign.onFill(tint))
            .frame(width: size, height: size)
            .background(Circle().fill(tint))
            .overlay(
                Circle()
                    .stroke(FestivalDesign.surface.opacity(0.85), lineWidth: 2)
            )
            .festivalShadow(.high)
    }
}

private struct HomeMapPillButtonStyle: ButtonStyle {
    let tint: Color
    let isFilled: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.festival(.caption, weight: .bold))
            .lineLimit(1)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(isFilled ? tint : tint.opacity(0.12))
            .foregroundStyle(isFilled ? FestivalDesign.onFill(tint) : FestivalDesign.readable(tint))
            .clipShape(FestivalDesign.controlShape)
            .overlay(
                FestivalDesign.controlShape
                    .stroke(isFilled ? Color.clear : tint.opacity(0.25), lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .opacity(configuration.isPressed ? 0.86 : 1)
    }
}

private protocol OverlayPinSource {
    var id: String { get }
    var coordinate: CLLocationCoordinate2D { get }
    /// 같은 셀 안이라도 이 값이 다르면 서로 다른 클러스터로 갈린다. 분류 구분이 없는 핀은 0.
    var clusterGroupKey: Int { get }
}

private extension OverlayPinSource {
    var clusterGroupKey: Int { 0 }
}

/// 오버레이 그룹 키. 문자열 보간 대신 정수 세 개로 묶어 핀마다 생기던 문자열 할당을 없앤다.
private struct OverlayGroupKey: Hashable {
    let x: Int
    let y: Int
    let group: Int
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
    /// `layerTint`는 이 핀을 만들어낸 지도 상단 토글의 색이다. 같은 축제가 여러 레이어에 들어올 수 있어
    /// 모델만으로는 소속 레이어를 알 수 없으므로 만들 때 함께 들고 다닌다.
    case festival(Festival, layerTint: UIColor)
    case event(FreeEvent, layerTint: UIColor)

    var id: String {
        switch self {
        case .festival(let festival, _):
            return "festival-\(festival.id)"
        case .event(let event, _):
            return "event-\(event.id)"
        }
    }

    var coordinate: CLLocationCoordinate2D {
        switch self {
        case .festival(let festival, _):
            return CLLocationCoordinate2D(latitude: festival.lat, longitude: festival.lng)
        case .event(let event, _):
            return CLLocationCoordinate2D(latitude: event.lat, longitude: event.lng)
        }
    }

    var layerTint: UIColor {
        switch self {
        case .festival(_, let tint), .event(_, let tint):
            return tint
        }
    }

    /// 레이어 토글 색이 곧 이 핀의 분류다(축제·공연·박람회·가게 이벤트가 각기 다른 색).
    /// 색을 RGB 정수 하나로 굳혀 클러스터 그룹 키로 쓴다.
    var clusterGroupKey: Int {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        layerTint.getRed(&r, green: &g, blue: &b, alpha: &a)
        let red = Int((r * 255).rounded())
        let green = Int((g * 255).rounded())
        let blue = Int((b * 255).rounded())
        return (red << 16) | (green << 8) | blue
    }
}

private extension CLLocationCoordinate2D {
    func offsetByMeters(east: Double, north: Double) -> CLLocationCoordinate2D {
        let latOffset = north / 111_320.0
        let lngOffset = east / max(40_000.0, 111_320.0 * cos(latitude * .pi / 180))
        return CLLocationCoordinate2D(latitude: latitude + latOffset, longitude: longitude + lngOffset)
    }
}

private extension ParkingLot {
    /// 목적지 없이 주차장 핀만 눌렀을 때, 상세 화면 기준점으로 쓸 자기 자신.
    var asDestination: Destination {
        Destination(id: id, name: name, address: address, lat: lat, lng: lng, source: source)
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
                        .font(.festival(.caption2, weight: .bold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(FestivalDesign.teal.opacity(0.16))
                        .foregroundStyle(FestivalDesign.tealText)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                Text("\(parkingLot.distanceFromDestinationMeters)m")
                    .font(.festival(.caption))
                    .foregroundStyle(FestivalDesign.secondaryText)
                Spacer()
            }

            Text(parkingLot.name)
                .font(.festival(.headline))
                .foregroundStyle(FestivalDesign.navy)
                .lineLimit(2)
            HStack(spacing: 6) {
                Text("\u{CD94}\u{CC9C} \(recommendation.scorePercent)\u{C810}")
                    .font(.festival(.caption, weight: .bold))
                    .foregroundStyle(FestivalDesign.tealText)
                Text(recommendation.primaryReason)
                    .font(.festival(.caption))
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(1)
            }
            Text(parkingLot.displayStatus)
                .font(.festival(.subheadline, weight: .semibold))
                .foregroundStyle(statusColor)
            HStack(spacing: 4) {
                Circle()
                    .fill(statusColor)
                    .frame(width: 8, height: 8)
                Text("혼잡도 \(parkingLot.congestionStatus.label)")
                    .font(.festival(.caption, weight: .semibold))
                    .foregroundStyle(statusColor)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("혼잡도 \(parkingLot.congestionStatus.label)")
            Text(parkingLot.feeSummary ?? "\u{C694}\u{AE08} \u{C815}\u{BCF4} \u{C5C6}\u{C74C}")
                .font(.festival(.caption))
                .foregroundStyle(FestivalDesign.secondaryText)
                .fixedSize(horizontal: false, vertical: true)

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
        .festivalShadow(.low)
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
    let onOpenMap: () -> Void
    let onDetail: () -> Void
    let onNavigate: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(parkingLot.name)
                        .font(.festival(.headline))
                        .foregroundStyle(FestivalDesign.navy)
                        .lineLimit(2)
                    Text(parkingLot.address)
                        .font(.festival(.caption))
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
                congestionPill
            }

            feeRow

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
        .background(FestivalDesign.surface.opacity(0.97))
        .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
        .overlay(
            RoundedRectangle(cornerRadius: FestivalDesign.cardRadius)
                .stroke(FestivalDesign.creamDeep.opacity(0.45), lineWidth: 1)
        )
        .festivalShadow(.high)
    }

    private var congestionPill: some View {
        let tint = FestivalDesign.congestionColor(parkingLot.congestionStatus)
        return VStack(alignment: .leading, spacing: 2) {
            Text("혼잡도")
                .font(.festival(.caption2, weight: .semibold))
                .foregroundStyle(FestivalDesign.secondaryText)
            HStack(spacing: 4) {
                Circle()
                    .fill(tint)
                    .frame(width: 8, height: 8)
                Text(parkingLot.congestionStatus.label)
                    .font(.festival(.caption, weight: .semibold))
                    .foregroundStyle(tint)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(tint.opacity(0.14))
        .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("혼잡도 \(parkingLot.congestionStatus.label)")
    }

    // 요금 문구는 길이가 제각각이라 잘리면 안 된다. 한 줄 폭을 다 쓰고 넘치면 줄바꿈한다.
    private var feeRow: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("요금")
                .font(.festival(.caption2, weight: .semibold))
                .foregroundStyle(FestivalDesign.secondaryText)
            Text(parkingLot.feeSummary ?? "정보 없음")
                .font(.festival(.caption, weight: .semibold))
                .foregroundStyle(FestivalDesign.navy)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(FestivalDesign.cream.opacity(0.42))
        .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
    }

    private func parkingInfoPill(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.festival(.caption2, weight: .semibold))
                .foregroundStyle(FestivalDesign.secondaryText)
            Text(value)
                .font(.festival(.caption, weight: .semibold))
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(FestivalDesign.cream.opacity(0.42))
        .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
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
                RemoteImage(url: url, downsamplePoints: size) {
                    placeholder
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
            .font(.festival(.title3, weight: .semibold))
            .foregroundStyle(FestivalDesign.readable(tint))
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// 같은 장소에 몰린 다수 이벤트를 탭했을 때 뜨는 목록 시트.
private struct EventStackSheet: View {
    let items: [DiscoverListItem]
    let onSelect: (DiscoverListItem.Kind) -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "mappin.and.ellipse")
                    .font(.festival(.subheadline, weight: .bold))
                    .foregroundStyle(FestivalDesign.tealText)
                Text("이 위치의 이벤트")
                    .font(.festival(.headline))
                    .foregroundStyle(FestivalDesign.navy)
                Text("\(items.count)")
                    .font(.festival(.caption, weight: .bold))
                    .foregroundStyle(FestivalDesign.tealText)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(FestivalDesign.tealSoft)
                    .clipShape(FestivalDesign.controlShape)
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.top, 18)
            .padding(.bottom, 10)

            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(items) { item in
                        Button { onSelect(item.kind) } label: {
                            row(item)
                        }
                        .buttonStyle(.plain)
                        Divider().padding(.leading, 80)
                    }
                }
            }
        }
        .background(FestivalDesign.surface)
    }

    private func row(_ item: DiscoverListItem) -> some View {
        HStack(spacing: 12) {
            DiscoverThumbnail(imageUrl: item.imageUrl, tint: item.tint, symbol: item.symbol, size: 52)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title)
                    .font(.festival(.subheadline, weight: .semibold))
                    .foregroundStyle(FestivalDesign.navy)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Text(item.dateText)
                    .font(.festival(.caption))
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(1)
                Text(item.statusText)
                    .font(.festival(.caption2, weight: .bold))
                    .foregroundStyle(item.status.chipText)
            }
            Spacer(minLength: 4)
            Image(systemName: "chevron.right")
                .font(.festival(.caption, weight: .bold))
                .foregroundStyle(FestivalDesign.secondaryText.opacity(0.6))
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 16)
        .contentShape(Rectangle())
    }
}


/// 홀로그램 카드가 붙는 화면 좌표. 지도 카메라를 따라 30Hz로 갱신되므로 지도 body가 아니라
/// 카드·커넥터만 구독하게 해서, 갱신이 핀 파이프라인 재계산으로 번지지 않게 한다.
private final class HologramAnchorModel: ObservableObject {
    @Published var point: CGPoint = .zero
}

/// 카드 내용은 부모가 만들어 넘기고, 앵커에 따라 달라지는 위치 계산만 여기서 한다.
private struct HologramAnchoredCard<Content: View>: View {
    @ObservedObject var anchor: HologramAnchorModel
    let cardWidth: CGFloat
    let containerSize: CGSize
    let connectorHeight: CGFloat
    let overlayHeight: CGFloat
    private let content: Content

    init(
        anchor: HologramAnchorModel,
        cardWidth: CGFloat,
        containerSize: CGSize,
        connectorHeight: CGFloat,
        overlayHeight: CGFloat,
        @ViewBuilder content: () -> Content
    ) {
        self.anchor = anchor
        self.cardWidth = cardWidth
        self.containerSize = containerSize
        self.connectorHeight = connectorHeight
        self.overlayHeight = overlayHeight
        self.content = content()
    }

    var body: some View {
        let containerWidth = max(containerSize.width, cardWidth)
        let totalHeight = overlayHeight + connectorHeight
        let containerHeight = max(containerSize.height, totalHeight)
        let halfWidth = cardWidth / 2
        let clampedX = min(max(anchor.point.x, halfWidth + 8), containerWidth - halfWidth - 8)
        // card는 connector 위 → bottom이 anchor.y - connectorHeight에 위치
        let preferredY = anchor.point.y - connectorHeight - overlayHeight / 2
        let minY = overlayHeight / 2 + 60
        let maxY = containerHeight - totalHeight / 2 - 12
        content.position(x: clampedX, y: min(max(preferredY, minY), maxY))
    }
}

private struct HologramConnectorLayer: View {
    @ObservedObject var anchor: HologramAnchorModel
    let cardWidth: CGFloat
    let containerWidth: CGFloat
    let connectorHeight: CGFloat
    let tint: Color

    var body: some View {
        let halfWidth = cardWidth / 2
        let clampedX = min(
            max(anchor.point.x, halfWidth + 8),
            max(containerWidth, cardWidth) - halfWidth - 8
        )
        VStack(spacing: 0) {
            Rectangle()
                .fill(LinearGradient(
                    colors: [tint.opacity(0.35), tint.opacity(0.7)],
                    startPoint: .top,
                    endPoint: .bottom
                ))
                .frame(width: 2, height: 10)
            Circle()
                .fill(tint)
                .frame(width: 6, height: 6)
        }
        .allowsHitTesting(false)
        .position(x: clampedX, y: anchor.point.y - connectorHeight / 2)
    }
}

/// 지도 body는 위치 갱신·레이아웃 변화·검색어 입력마다 다시 평가된다. 그때마다 수백 개 핀을
/// 다시 묶고 정렬하면 그대로 렉이 되므로, 입력이 그대로면 지난 결과를 돌려준다.
/// 키에 빠진 입력이 있으면 화면이 낡은 채로 남으므로, 파이프라인이 읽는 값은 모두 키에 넣는다.
private final class MapPinCache {
    struct DiscoverKey: Equatable {
        let revision: Int
        let showsFestival: Bool
        let showsTradeExpo: Bool
        let showsLocalEvent: Bool
        let showsPerformance: Bool
        let filter: FestivalFilter
        let theme: FestivalTheme
        let isDarkMode: Bool
    }

    struct PinKey: Equatable {
        let discover: DiscoverKey
        let clip: ClipKey
        let zoomLevel: Int
        let selectedDiscoverPinID: String?
        let showsRealtimeParking: Bool
        let showsFreeParking: Bool
        let discoverParkingContext: Bool
        let destinationID: String?
        let photoGeneration: Int
    }

    struct ViewportKey: Equatable {
        let discover: DiscoverKey
        let centerLat: Double
        let centerLng: Double
        let radiusMeters: Int
    }

    /// 핀 파이프라인에 넣을 소스를 화면 주변으로 잘라내는 기준.
    struct ClipKey: Equatable {
        let discover: DiscoverKey
        let centerLat: Double
        let centerLng: Double
        let radiusMeters: Int
        let selectedDiscoverPinID: String?
    }

    private var discoverKey: DiscoverKey?
    private var discoverValue: [DiscoverPinSource] = []
    private var pinKey: PinKey?
    private var pinValue: [MapPinItem] = []
    private var viewportKey: ViewportKey?
    private var viewportValue: [DiscoverPinSource] = []
    private var clipKey: ClipKey?
    private var clipValue: [DiscoverPinSource] = []

    func discoverSources(_ key: DiscoverKey, build: () -> [DiscoverPinSource]) -> [DiscoverPinSource] {
        if discoverKey == key { return discoverValue }
        let value = build()
        discoverKey = key
        discoverValue = value
        return value
    }

    func clippedDiscoverSources(_ key: ClipKey, build: () -> [DiscoverPinSource]) -> [DiscoverPinSource] {
        if clipKey == key { return clipValue }
        let value = build()
        clipKey = key
        clipValue = value
        return value
    }

    func pins(_ key: PinKey, build: () -> [MapPinItem]) -> [MapPinItem] {
        if pinKey == key { return pinValue }
        let value = build()
        pinKey = key
        pinValue = value
        return value
    }

    func visibleDiscoverSources(_ key: ViewportKey, build: () -> [DiscoverPinSource]) -> [DiscoverPinSource] {
        if viewportKey == key { return viewportValue }
        let value = build()
        viewportKey = key
        viewportValue = value
        return value
    }
}
