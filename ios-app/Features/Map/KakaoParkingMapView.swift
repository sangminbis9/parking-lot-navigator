import CoreLocation
import KakaoMapsSDK
import SwiftUI
import UIKit

struct KakaoParkingMapView: UIViewRepresentable {
    let center: CLLocationCoordinate2D
    let zoomLevel: Int
    let pins: [MapPinItem]
    let selectedPinID: String?
    let onTap: () -> Void
    let onPinTap: (MapPinItem, CGPoint?) -> Void
    let onCameraIdle: (MapViewport) -> Void
    var onCameraWillMove: (() -> Void)? = nil
    /// 아직 올려야 할 핀이 여러 프레임 분량 남았는지. 그동안은 지도가 제스처를 제대로 못 받는다.
    var onPinRenderPending: ((Bool) -> Void)? = nil
    var projector: MapProjector? = nil

    func makeUIView(context: Context) -> KMViewContainer {
        let view = KMViewContainer()
        view.sizeToFit()
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleTap(_:)))
        tap.cancelsTouchesInView = false
        tap.delaysTouchesBegan = false
        tap.delaysTouchesEnded = false
        tap.delegate = context.coordinator
        let pinch = UIPinchGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handlePinch(_:)))
        pinch.cancelsTouchesInView = false
        pinch.delaysTouchesBegan = false
        pinch.delaysTouchesEnded = false
        pinch.delegate = context.coordinator
        context.coordinator.latestCamera = MapCameraTarget(coordinate: center, zoomLevel: zoomLevel)
        context.coordinator.latestPins = pins
        context.coordinator.selectedPinID = selectedPinID
        context.coordinator.onTap = onTap
        context.coordinator.onPinTap = onPinTap
        context.coordinator.onCameraIdle = onCameraIdle
        context.coordinator.onCameraWillMove = onCameraWillMove
        context.coordinator.onPinRenderPending = onPinRenderPending
        projector?.coordinator = context.coordinator
        view.addGestureRecognizer(tap)
        view.addGestureRecognizer(pinch)
        context.coordinator.createController(view)
        context.coordinator.prepareEngineIfNeeded()
        context.coordinator.activateEngineIfNeeded()
        return view
    }

    func updateUIView(_ uiView: KMViewContainer, context: Context) {
        context.coordinator.latestCamera = MapCameraTarget(coordinate: center, zoomLevel: zoomLevel)
        context.coordinator.latestPins = pins
        context.coordinator.selectedPinID = selectedPinID
        context.coordinator.onTap = onTap
        context.coordinator.onPinTap = onPinTap
        context.coordinator.onCameraIdle = onCameraIdle
        context.coordinator.onCameraWillMove = onCameraWillMove
        context.coordinator.onPinRenderPending = onPinRenderPending
        projector?.coordinator = context.coordinator
        context.coordinator.activateEngineIfNeeded()
        context.coordinator.render()
    }

    static func dismantleUIView(_ uiView: KMViewContainer, coordinator: Coordinator) {
        coordinator.removeObservers()
        coordinator.pauseEngine()
        coordinator.controller?.resetEngine()
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    final class Coordinator: NSObject, MapControllerDelegate, UIGestureRecognizerDelegate {
        var controller: KMController?
        fileprivate var latestCamera = MapCameraTarget(
            coordinate: CLLocationCoordinate2D(latitude: 37.5665, longitude: 126.9780),
            zoomLevel: 13
        )
        var latestPins: [MapPinItem] = []
        var selectedPinID: String?
        var onTap: (() -> Void)?
        var onPinTap: ((MapPinItem, CGPoint?) -> Void)?
        var onCameraIdle: ((MapViewport) -> Void)?
        var onCameraWillMove: (() -> Void)?
        private var lastTapPoint: CGPoint?

        private weak var container: KMViewContainer?
        private var enginePrepared = false
        private var engineActive = false
        private var mapReady = false
        private var stylesReady = false
        private var renderedCamera: MapCameraTarget?
        private var renderedPinSnapshot: [MapPinSnapshot] = []
        /// 지도에 실제로 올라가 있는 POI. poiID → 스냅샷. 바뀐 핀만 교체해 깜빡임을 막는다.
        private var renderedPins: [String: MapPinSnapshot] = [:]
        private var observers: [NSObjectProtocol] = []
        private var poiTapHandlers: [String: DisposableEventHandler] = [:]
        private var cameraStoppedEventHandler: DisposableEventHandler?
        private var cameraStartedEventHandler: DisposableEventHandler?
        private var registeredDynamicStyleIDs: Set<String> = []
        private var suppressDiscoverLabelsAfterGesture = false
        private var showAllDiscoverLabelsAfterZoomIn = false
        /// 이번 패스에서 못 올린 핀이 남았는지. 남으면 다음 런루프에 이어서 올린다.
        private var pendingPinChunk = false
        private var pinChunkScheduled = false
        var onPinRenderPending: ((Bool) -> Void)?
        private var lastReportedPinPending = false

        /// 한 번의 render에서 새로 그리고 등록할 핀 개수 상한.
        /// 콜드 스타트에는 수백 개가 한꺼번에 들어오는데, 핀 하나마다 비트맵 드로잉과
        /// addPoiStyle(텍스처 등록)이 메인 스레드에서 일어나 그 사이 제스처가 통째로 밀린다.
        /// 프레임 하나 분량씩 끊어 올려 지도를 붙잡지 않는다.
        private static let maxPinsPerRenderPass = 40

        func createController(_ view: KMViewContainer) {
            container = view
            controller = KMController(viewContainer: view)
            controller?.delegate = self
            addObservers()
        }

        func prepareEngineIfNeeded() {
            guard !enginePrepared else { return }
            controller?.prepareEngine()
            enginePrepared = true
        }

        func activateEngineIfNeeded() {
            prepareEngineIfNeeded()
            guard !engineActive else { return }
            controller?.activateEngine()
            engineActive = true
        }

        func pauseEngine() {
            guard engineActive else { return }
            controller?.pauseEngine()
            engineActive = false
        }

        func removeObservers() {
            observers.forEach { NotificationCenter.default.removeObserver($0) }
            observers = []
            cameraStoppedEventHandler?.dispose()
            cameraStoppedEventHandler = nil
            cameraStartedEventHandler?.dispose()
            cameraStartedEventHandler = nil
        }

        @objc func handleTap(_ gesture: UITapGestureRecognizer) {
            let location = gesture.location(in: container)
            lastTapPoint = location
            if let tappedPin = pin(at: location) {
                suppressDiscoverLabelsAfterGesture = false
                onPinTap?(tappedPin, location)
                return
            }
            onTap?()
        }

        @objc func handlePinch(_ gesture: UIPinchGestureRecognizer) {
            guard gesture.state == .ended || gesture.state == .cancelled else { return }
            if gesture.scale > 1.06 {
                updateDiscoverLabelVisibility(suppressLabels: false, showAllLabels: false)
            } else if gesture.scale < 0.94 {
                updateDiscoverLabelVisibility(suppressLabels: true, showAllLabels: false)
            }
        }

        private func updateDiscoverLabelVisibility(suppressLabels: Bool, showAllLabels: Bool) {
            guard suppressDiscoverLabelsAfterGesture != suppressLabels ||
                showAllDiscoverLabelsAfterZoomIn != showAllLabels else {
                return
            }
            suppressDiscoverLabelsAfterGesture = suppressLabels
            showAllDiscoverLabelsAfterZoomIn = showAllLabels
            render()
        }

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            true
        }

        @objc func addViews() {
            let mapPoint = MapPoint(
                longitude: latestCamera.coordinate.longitude,
                latitude: latestCamera.coordinate.latitude
            )
            let info = MapviewInfo(
                viewName: "mapview",
                viewInfoName: "map",
                defaultPosition: mapPoint,
                defaultLevel: latestCamera.zoomLevel
            )
            controller?.addView(info)
        }

        @objc func addViewSucceeded(_ viewName: String, viewInfoName: String) {
            mapReady = true
            updateMapRect()
            configureLabelsIfNeeded()
            configureCameraEventsIfNeeded()
            render()
        }

        @objc func addViewFailed(_ viewName: String, viewInfoName: String) {
            mapReady = false
        }

        @objc func containerDidResized(_ size: CGSize) {
            updateMapRect(size: size)
        }

        @objc func authenticationFailed(_ errorCode: Int, desc: String) {
            AppLogger.app.error("KakaoMapsSDK authentication failed: \(errorCode, privacy: .public) \(desc, privacy: .public)")
        }

        func render() {
            guard mapReady, let mapView = controller?.getView("mapview") as? KakaoMap else { return }
            updateMapRect()
            configureLabelsIfNeeded()
            configureCameraEventsIfNeeded()
            if shouldMoveCamera {
                suppressDiscoverLabelsAfterGesture = false
                showAllDiscoverLabelsAfterZoomIn = false
                moveCamera(on: mapView)
                renderedCamera = latestCamera
            }
            let pinSnapshot = latestPins.map {
                MapPinSnapshot(
                    pin: $0,
                    showsDiscoverLabels: showsDiscoverLabels,
                    showsAllDiscoverLabels: showsAllDiscoverLabels,
                    isSelected: $0.id == selectedPinID
                )
            }
            if renderedPinSnapshot != pinSnapshot || pendingPinChunk {
                renderPins(on: mapView, snapshots: pinSnapshot)
                renderedPinSnapshot = pinSnapshot
            }
        }

        private var showsDiscoverLabels: Bool {
            !suppressDiscoverLabelsAfterGesture && (latestCamera.zoomLevel >= 17 || showAllDiscoverLabelsAfterZoomIn)
        }

        private var showsAllDiscoverLabels: Bool {
            !suppressDiscoverLabelsAfterGesture && showAllDiscoverLabelsAfterZoomIn
        }

        private var shouldMoveCamera: Bool {
            guard let renderedCamera else { return true }
            return renderedCamera != latestCamera
        }

        private func moveCamera(on mapView: KakaoMap) {
            let target = MapPoint(
                longitude: latestCamera.coordinate.longitude,
                latitude: latestCamera.coordinate.latitude
            )
            let cameraUpdate = CameraUpdate.make(target: target, zoomLevel: latestCamera.zoomLevel, mapView: mapView)
            mapView.moveCamera(cameraUpdate)
        }

        private func updateMapRect(size: CGSize? = nil) {
            guard let mapView = controller?.getView("mapview") as? KakaoMap else { return }
            let resolvedSize = size ?? container?.bounds.size ?? .zero
            guard resolvedSize.width > 0, resolvedSize.height > 0 else { return }
            mapView.viewRect = CGRect(origin: .zero, size: resolvedSize)
        }

        private func addObservers() {
            guard observers.isEmpty else { return }
            let center = NotificationCenter.default
            observers = [
                center.addObserver(
                    forName: UIApplication.willResignActiveNotification,
                    object: nil,
                    queue: .main
                ) { [weak self] _ in
                    self?.pauseEngine()
                },
                center.addObserver(
                    forName: UIApplication.didBecomeActiveNotification,
                    object: nil,
                    queue: .main
                ) { [weak self] _ in
                    self?.activateEngineIfNeeded()
                }
            ]
        }

        private func configureLabelsIfNeeded() {
            guard !stylesReady, let mapView = controller?.getView("mapview") as? KakaoMap else { return }
            let manager = mapView.getLabelManager()
            let layerOption = LabelLayerOptions(
                layerID: "parking-pins",
                competitionType: .none,
                competitionUnit: .symbolFirst,
                orderType: .rank,
                // 지도 엔진의 기본 심볼/라벨도 내부 LabelLayer라 zOrder로 순서를 다툰다.
                // 큰 값을 줘 우리 핀이 항상 지도 요소 위에 오게 한다.
                zOrder: 10_001
            )
            _ = manager.addLabelLayer(option: layerOption)

            // 현재 위치/목적지 핀은 기존 디자인을 유지하며 1회만 등록한다.
            // 카테고리(주차장/축제/이벤트)·클러스터 핀은 테마·선택 상태를 styleID에 담아
            // renderPins에서 on-demand 등록한다 (테마 변경 시 자동 갱신).
            manager.addPoiStyle(
                makeStyle(
                    id: "current-location",
                    image: .currentLocationPin,
                    anchor: CGPoint(x: 0.5, y: 0.5)
                )
            )
            manager.addPoiStyle(makeStyle(id: "destination", image: .destinationPin))
            stylesReady = true
        }

        private func configureCameraEventsIfNeeded() {
            guard let mapView = controller?.getView("mapview") as? KakaoMap else { return }
            if cameraStoppedEventHandler == nil {
                cameraStoppedEventHandler = mapView.addCameraStoppedEventHandler(
                    target: self,
                    handler: KakaoParkingMapView.Coordinator.cameraStoppedHandler
                )
            }
            if cameraStartedEventHandler == nil {
                cameraStartedEventHandler = mapView.addCameraWillMovedEventHandler(
                    target: self,
                    handler: KakaoParkingMapView.Coordinator.cameraWillMoveHandler
                )
            }
        }

        func cameraStoppedHandler(_ param: CameraActionEventParam) {
            guard let mapView = param.view as? KakaoMap else { return }
            let viewport = viewport(for: mapView)
            latestCamera = MapCameraTarget(coordinate: viewport.center, zoomLevel: viewport.zoomLevel)
            renderedCamera = latestCamera
            onCameraIdle?(viewport)
        }

        func cameraWillMoveHandler(_ param: CameraActionEventParam) {
            guard param.by != .notUserAction else { return }
            onCameraWillMove?()
        }

        private func viewport(for mapView: KakaoMap) -> MapViewport {
            let size = container?.bounds.size ?? mapView.viewRect.size
            let width = max(size.width, 1)
            let height = max(size.height, 1)
            let centerPoint = CGPoint(x: width / 2, y: height / 2)
            let cornerPoint = CGPoint(x: width - 1, y: height - 1)
            let center = mapView.getPosition(centerPoint).wgsCoord
            let corner = mapView.getPosition(cornerPoint).wgsCoord
            let centerCoordinate = CLLocationCoordinate2D(latitude: center.latitude, longitude: center.longitude)
            let cornerCoordinate = CLLocationCoordinate2D(latitude: corner.latitude, longitude: corner.longitude)
            let radiusMeters = CLLocation(latitude: centerCoordinate.latitude, longitude: centerCoordinate.longitude)
                .distance(from: CLLocation(latitude: cornerCoordinate.latitude, longitude: cornerCoordinate.longitude))
            return MapViewport(
                center: centerCoordinate,
                zoomLevel: mapView.zoomLevel,
                radiusMeters: max(Int(radiusMeters * 1.1), 800)
            )
        }

        private func makeStyle(id: String, image: UIImage, anchor: CGPoint = CGPoint(x: 0.5, y: 1.0)) -> PoiStyle {
            let iconStyle = PoiIconStyle(symbol: image, anchorPoint: anchor)
            return PoiStyle(styleID: id, styles: [
                PerLevelPoiStyle(iconStyle: iconStyle, level: 0)
            ])
        }

        /// 카메라 이동·데이터 재조회 때마다 전체를 지우고 다시 그리면 남아 있어야 할 핀까지 깜빡인다.
        /// 그래서 사라졌거나 좌표·스타일이 달라진 POI만 지우고, 새로 생긴 것만 추가한다.
        private func renderPins(on mapView: KakaoMap, snapshots: [MapPinSnapshot]) {
            let manager = mapView.getLabelManager()
            guard let layer = manager.getLabelLayer(layerID: "parking-pins") else { return }

            var desired: [String: (pin: MapPinItem, snapshot: MapPinSnapshot)] = [:]
            for (pin, snapshot) in zip(latestPins, snapshots) {
                desired[snapshot.poiID] = (pin, snapshot)
            }

            var staleIDs: [String] = []
            for (poiID, rendered) in renderedPins where desired[poiID]?.snapshot != rendered {
                staleIDs.append(poiID)
            }
            if !staleIDs.isEmpty {
                layer.removePois(poiIDs: staleIDs)
                for poiID in staleIDs {
                    // POI를 지우면 핸들러도 함께 무효화되므로 참조만 놓아준다(기존 동작과 동일).
                    poiTapHandlers.removeValue(forKey: poiID)
                    renderedPins.removeValue(forKey: poiID)
                }
            }

            var options: [PoiOptions] = []
            var positions: [MapPoint] = []
            var addedIDs: [String] = []
            var clickableIDs: Set<String> = []
            var deferredCount = 0
            for (poiID, entry) in desired where renderedPins[poiID] == nil {
                guard options.count < Coordinator.maxPinsPerRenderPass else {
                    deferredCount += 1
                    continue
                }
                let pin = entry.pin
                let styleID = entry.snapshot.styleID
                if !registeredDynamicStyleIDs.contains(styleID),
                   let style = pin.dynamicDiscoverStyleIDAndImage(styleID: styleID) {
                    // 클러스터는 원형 버블 → 좌표에 중심을 맞춘다. 개별 핀은 물방울 tip(0.5,1.0).
                    let anchor: CGPoint = {
                        if case .cluster = pin.kind { return CGPoint(x: 0.5, y: 0.5) }
                        return CGPoint(x: 0.5, y: 1.0)
                    }()
                    manager.addPoiStyle(makeStyle(id: style.id, image: style.image, anchor: anchor))
                    registeredDynamicStyleIDs.insert(style.id)
                }
                let option = PoiOptions(styleID: styleID, poiID: poiID)
                option.rank = rank(for: pin.kind)
                // 내 위치 핀은 보여줄 정보가 없으므로 탭 대상에서 뺀다.
                option.clickable = !pin.isCurrentLocation
                options.append(option)
                positions.append(MapPoint(longitude: pin.coordinate.longitude, latitude: pin.coordinate.latitude))
                addedIDs.append(poiID)
                if !pin.isCurrentLocation { clickableIDs.insert(poiID) }
                renderedPins[poiID] = entry.snapshot
            }
            pendingPinChunk = deferredCount > 0
            reportPinPending(deferredCount > Coordinator.maxPinsPerRenderPass)
            scheduleNextPinChunkIfNeeded()
            guard !options.isEmpty else { return }

            // 앱을 새로 열면 수십~수백 개가 한 번에 들어온다. 카카오맵 문서가 권장하는 대로
            // addPoi/show를 개수만큼 반복하지 않고 addPois·showPois로 한 번에 넘긴다.
            let added = layer.addPois(options: options, at: positions) ?? []
            for poi in added where clickableIDs.contains(poi.itemID) {
                poiTapHandlers[poi.itemID] = poi.addPoiTappedEventHandler(
                    target: self,
                    handler: KakaoParkingMapView.Coordinator.poiTappedHandler
                )
            }
            layer.showPois(poiIDs: addedIDs)
        }

        /// 렌더가 몇 프레임 더 이어질 때만 알린다. 한 패스로 끝나는 소량 갱신까지 알리면
        /// 로딩 표시가 한 프레임 깜빡인다.
        private func reportPinPending(_ pending: Bool) {
            guard pending != lastReportedPinPending else { return }
            lastReportedPinPending = pending
            // updateUIView 안에서 불릴 수 있어, 뷰 갱신 도중 상태를 바꾸지 않도록 다음 런루프로 미룬다.
            let notify = onPinRenderPending
            DispatchQueue.main.async { notify?(pending) }
        }

        /// 남은 핀은 다음 프레임에 올린다. asyncAfter로 한 프레임을 비워 줘야
        /// 그 사이 터치/카메라 이벤트가 처리된다.
        private func scheduleNextPinChunkIfNeeded() {
            guard pendingPinChunk, !pinChunkScheduled else { return }
            pinChunkScheduled = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0 / 60.0) { [weak self] in
                guard let self else { return }
                self.pinChunkScheduled = false
                self.render()
            }
        }

        func poiTappedHandler(_ param: PoiInteractionEventParam) {
            guard let tappedPin = latestPins.first(where: { $0.poiID == param.poiItem.itemID }) else { return }
            onPinTap?(tappedPin, lastTapPoint)
        }

        private func pin(at touchPoint: CGPoint) -> MapPinItem? {
            guard let mapView = controller?.getView("mapview") as? KakaoMap else { return nil }
            let touchedMapPoint = mapView.getPosition(touchPoint)
            let referencePoint = CGPoint(x: touchPoint.x + 36, y: touchPoint.y)
            let referenceMapPoint = mapView.getPosition(referencePoint)
            let touchCoordinate = CLLocationCoordinate2D(
                latitude: touchedMapPoint.wgsCoord.latitude,
                longitude: touchedMapPoint.wgsCoord.longitude
            )
            let touchRadius = CLLocation(latitude: touchCoordinate.latitude, longitude: touchCoordinate.longitude).distance(
                from: CLLocation(latitude: referenceMapPoint.wgsCoord.latitude, longitude: referenceMapPoint.wgsCoord.longitude)
            )
            let thresholdMeters = max(touchRadius, 40)

            return latestPins
                .filter { !$0.isCurrentLocation }
                .map { pin in
                    (
                        pin,
                        CLLocation(latitude: touchCoordinate.latitude, longitude: touchCoordinate.longitude).distance(
                            from: CLLocation(latitude: pin.coordinate.latitude, longitude: pin.coordinate.longitude)
                        )
                    )
                }
                .filter { _, distance in distance <= thresholdMeters }
                .sorted { $0.1 < $1.1 }
                .first?
                .0
        }

        private func rank(for kind: MapPinItem.Kind) -> Int {
            switch kind {
            case .currentLocation:
                return 30
            case .destination:
                return 20
            case .parking:
                return 10
            case .festival:
                return 12
            case .event:
                return 12
            case .cluster:
                return 16
            }
        }

        func screenPoint(for coord: CLLocationCoordinate2D) -> CGPoint? {
            guard let mapView = controller?.getView("mapview") as? KakaoMap else { return nil }
            let size = container?.bounds.size ?? mapView.viewRect.size
            guard size.width > 8, size.height > 8 else { return nil }
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            let offset: CGFloat = 64
            let eastSample = CGPoint(x: center.x + offset, y: center.y)
            let southSample = CGPoint(x: center.x, y: center.y + offset)
            let centerCoord = mapView.getPosition(center).wgsCoord
            let eastCoord = mapView.getPosition(eastSample).wgsCoord
            let southCoord = mapView.getPosition(southSample).wgsCoord
            let dLngX = (eastCoord.longitude - centerCoord.longitude) / Double(offset)
            let dLatX = (eastCoord.latitude - centerCoord.latitude) / Double(offset)
            let dLngY = (southCoord.longitude - centerCoord.longitude) / Double(offset)
            let dLatY = (southCoord.latitude - centerCoord.latitude) / Double(offset)
            let deltaLng = coord.longitude - centerCoord.longitude
            let deltaLat = coord.latitude - centerCoord.latitude
            let det = dLngX * dLatY - dLngY * dLatX
            guard abs(det) > 1e-20 else { return nil }
            let dx = (deltaLng * dLatY - dLngY * deltaLat) / det
            let dy = (dLngX * deltaLat - dLatX * deltaLng) / det
            return CGPoint(x: center.x + CGFloat(dx), y: center.y + CGFloat(dy))
        }
    }
}

final class MapProjector {
    fileprivate weak var coordinator: KakaoParkingMapView.Coordinator?

    func screenPoint(for coord: CLLocationCoordinate2D) -> CGPoint? {
        coordinator?.screenPoint(for: coord)
    }
}

private struct MapCameraTarget: Equatable {
    let coordinate: CLLocationCoordinate2D
    let zoomLevel: Int

    static func == (lhs: MapCameraTarget, rhs: MapCameraTarget) -> Bool {
        lhs.coordinate.isClose(to: rhs.coordinate) &&
            lhs.zoomLevel == rhs.zoomLevel
    }
}

struct MapViewport: Equatable {
    let center: CLLocationCoordinate2D
    let zoomLevel: Int
    let radiusMeters: Int

    static func == (lhs: MapViewport, rhs: MapViewport) -> Bool {
        lhs.center.isClose(to: rhs.center) &&
            lhs.zoomLevel == rhs.zoomLevel &&
            lhs.radiusMeters == rhs.radiusMeters
    }
}

private struct MapPinSnapshot: Equatable {
    let id: String
    let coordinate: CLLocationCoordinate2D
    let styleID: String
    let poiID: String

    init(pin: MapPinItem, showsDiscoverLabels: Bool, showsAllDiscoverLabels: Bool, isSelected: Bool) {
        id = pin.id
        coordinate = pin.coordinate
        styleID = pin.styleID(
            showsDiscoverLabel: showsDiscoverLabels,
            showsAllDiscoverLabels: showsAllDiscoverLabels,
            isSelected: isSelected
        )
        poiID = pin.poiID
    }

    static func == (lhs: MapPinSnapshot, rhs: MapPinSnapshot) -> Bool {
        lhs.id == rhs.id &&
            lhs.coordinate.isClose(to: rhs.coordinate) &&
            lhs.styleID == rhs.styleID &&
            lhs.poiID == rhs.poiID
    }
}

/// 핀 스타일 ID의 테마 성분. 라이트/다크에 따라 핀 색이 달라지므로 외관까지 넣어야
/// 토글했을 때 카카오맵이 새 스타일을 등록하고 핀이 즉시 바뀐다.
private var pinStyleThemeKey: String {
    FestivalTheme.current.rawValue + "-" + FestivalAppearance.styleKey
}

private extension MapPinItem {
    var isCurrentLocation: Bool {
        if case .currentLocation = kind { return true }
        return false
    }

    var poiID: String {
        id.map { character in
            character.isLetter || character.isNumber || character == "-" || character == "_" ? character : "_"
        }
        .reduce(into: "") { result, character in
            result.append(character)
        }
    }

    func styleID(showsDiscoverLabel: Bool = false, showsAllDiscoverLabels: Bool = false, isSelected: Bool = false) -> String {
        let theme = pinStyleThemeKey
        switch kind {
        case .currentLocation:
            return "current-location"
        case .destination:
            return "destination"
        case .parking(let lot):
            if parkingCongestionColored {
                let key = lot.stale ? "stale" : lot.congestionStatus.rawValue
                let base = "parking-cong-\(key)-\(theme)"
                return isSelected ? "\(base)-sel" : base
            }
            return isSelected ? "parking-\(theme)-sel" : "parking-\(theme)"
        case .festival(let festival):
            return discoverStyleID(category: MapPinCategory.forFestival(festival), title: festival.title, theme: theme, showsDiscoverLabel: showsDiscoverLabel, showsAllDiscoverLabels: showsAllDiscoverLabels, isSelected: isSelected)
        case .event(let event):
            return discoverStyleID(category: MapPinCategory.forEvent(event), title: event.title, theme: theme, showsDiscoverLabel: showsDiscoverLabel, showsAllDiscoverLabels: showsAllDiscoverLabels, isSelected: isSelected, neon: event.usesMerchantNeonPin)
        case .cluster(let cluster):
            return "cluster-\(cluster.isParking ? "p" : "d")-\(cluster.count)-\(cluster.tint.stableStyleKey)-\(theme)"
        }
    }

    /// 레이어 토글 색을 테두리로 쓰므로 styleID에도 넣는다. 빠지면 카카오맵이 옛 색 스타일을 재사용한다.
    private var layerTintStyleKey: String {
        layerTint.map { "-t\($0.stableStyleKey)" } ?? ""
    }

    /// LIVE 라벨과 대표 이미지도 그림이 달라지는 요소라 styleID에 들어가야 한다.
    /// 이미지는 캐시에 들어온 뒤에야 붙으므로, 이 키가 바뀌면서 카카오맵이 새 스타일로 다시 등록한다.
    private var liveStyleKey: String { isLive ? "-live" : "" }
    private var photoStyleKey: String { photo.map { "-p\($0.key)" } ?? "" }

    private func discoverStyleID(category: MapPinCategory, title: String, theme: String, showsDiscoverLabel: Bool, showsAllDiscoverLabels: Bool, isSelected: Bool, neon: Bool = false) -> String {
        let base = "disc-\(category.rawValue)\(layerTintStyleKey)\(neon ? "-neon" : "")\(liveStyleKey)\(photoStyleKey)-\(theme)"
        if isSelected { return "\(base)-sel" }
        guard showsDiscoverLabel && (showsTitleLabel || showsAllDiscoverLabels) else { return base }
        return "\(base)-label-\(title.stableStyleKey)"
    }

    func dynamicDiscoverStyleIDAndImage(styleID: String) -> (id: String, image: UIImage)? {
        let theme = FestivalTheme.current
        let themeKey = pinStyleThemeKey
        switch kind {
        case .parking(let lot):
            if parkingCongestionColored {
                let key = lot.stale ? "stale" : lot.congestionStatus.rawValue
                let base = "parking-cong-\(key)-\(themeKey)"
                guard styleID == base || styleID == "\(base)-sel" else { return nil }
                let fill = lot.stale ? UIColor.systemGray : FestivalDesign.uiCongestionColor(lot.congestionStatus)
                return (styleID, MapPinRenderer.parkingImage(fill: fill, theme: theme, selected: styleID == "\(base)-sel"))
            }
            let base = "parking-\(themeKey)"
            guard styleID == base || styleID == "\(base)-sel" else { return nil }
            return (styleID, MapPinRenderer.image(category: .parking, theme: theme, selected: styleID == "\(base)-sel"))
        case .festival(let festival):
            return discoverImage(styleID: styleID, category: MapPinCategory.forFestival(festival), title: festival.title, theme: theme)
        case .event(let event):
            return discoverImage(styleID: styleID, category: MapPinCategory.forEvent(event), title: event.title, theme: theme, neon: event.usesMerchantNeonPin)
        case .cluster(let cluster):
            guard styleID == "cluster-\(cluster.isParking ? "p" : "d")-\(cluster.count)-\(cluster.tint.stableStyleKey)-\(themeKey)" else { return nil }
            return (styleID, MapPinRenderer.clusterImage(tint: cluster.tint, count: cluster.count, isParking: cluster.isParking, theme: theme))
        default:
            return nil
        }
    }

    private func discoverImage(styleID: String, category: MapPinCategory, title: String, theme: FestivalTheme, neon: Bool = false) -> (id: String, image: UIImage)? {
        let base = "disc-\(category.rawValue)\(layerTintStyleKey)\(neon ? "-neon" : "")\(liveStyleKey)\(photoStyleKey)-\(pinStyleThemeKey)"
        if styleID == "\(base)-sel" {
            return (styleID, MapPinRenderer.image(category: category, theme: theme, selected: true, border: layerTint, neon: neon, photo: photo, live: isLive))
        }
        if styleID == base {
            return (styleID, MapPinRenderer.image(category: category, theme: theme, selected: false, border: layerTint, neon: neon, photo: photo, live: isLive))
        }
        if styleID == "\(base)-label-\(title.stableStyleKey)" {
            return (styleID, MapPinRenderer.labeledImage(category: category, theme: theme, label: title.shortMapLabel, border: layerTint, neon: neon, photo: photo, live: isLive))
        }
        return nil
    }

}

private extension String {
    var shortMapLabel: String {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count > 12 else { return trimmed }
        return "\(String(trimmed.prefix(11)))..."
    }

    var stableStyleKey: String {
        let hash = unicodeScalars.reduce(UInt32(2166136261)) { partial, scalar in
            (partial ^ scalar.value) &* 16777619
        }
        return String(hash, radix: 16)
    }
}

private extension UIColor {
    var stableStyleKey: String {
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 0
        getRed(&red, green: &green, blue: &blue, alpha: &alpha)
        return [
            Int((red * 255).rounded()),
            Int((green * 255).rounded()),
            Int((blue * 255).rounded()),
            Int((alpha * 255).rounded())
        ]
        .map { String($0, radix: 16) }
        .joined(separator: "-")
    }
}

private extension CLLocationCoordinate2D {
    func isClose(to other: CLLocationCoordinate2D) -> Bool {
        abs(latitude - other.latitude) <= 0.000001 &&
            abs(longitude - other.longitude) <= 0.000001
    }
}

private extension UIImage {
    static var mapPinScale: CGFloat { 0.5 }
    static var pinShadowPadding: CGFloat { 6 }
    static var pinTailHeight: CGFloat { 7 }

    /// 내 위치는 "어떤 장소"가 아니라 "지금 내가 있는 지점"이라, 꼬리 달린 마커 대신
    /// 정확도 헤일로 + 링 + 코어 도트로 그린다. 앵커도 하단이 아니라 중앙이다.
    static var currentLocationPin: UIImage {
        let canvas: CGFloat = 44
        let renderer = UIGraphicsImageRenderer(
            size: CGSize(width: canvas * mapPinScale, height: canvas * mapPinScale)
        )
        return renderer.image { context in
            context.cgContext.scaleBy(x: mapPinScale, y: mapPinScale)
            let core = FestivalDesign.uiParkingBlue
            let center = CGPoint(x: canvas / 2, y: canvas / 2)

            let haloDiameter: CGFloat = 40
            let haloRect = CGRect(
                x: center.x - haloDiameter / 2,
                y: center.y - haloDiameter / 2,
                width: haloDiameter,
                height: haloDiameter
            )
            core.withAlphaComponent(0.13).setFill()
            UIBezierPath(ovalIn: haloRect).fill()

            let ringDiameter: CGFloat = 22
            let ringRect = CGRect(
                x: center.x - ringDiameter / 2,
                y: center.y - ringDiameter / 2,
                width: ringDiameter,
                height: ringDiameter
            )
            context.cgContext.saveGState()
            context.cgContext.setShadow(
                offset: CGSize(width: 0, height: 1),
                blur: 3,
                color: FestivalDesign.uiNavy.withAlphaComponent(0.28).cgColor
            )
            UIColor.white.setFill()
            UIBezierPath(ovalIn: ringRect).fill()
            context.cgContext.restoreGState()

            core.setFill()
            UIBezierPath(ovalIn: ringRect.insetBy(dx: 3.5, dy: 3.5)).fill()
        }
    }

    static var destinationPin: UIImage {
        haloPin(core: FestivalDesign.uiCoral, symbol: "flag.fill", size: 38, scale: mapPinScale)
    }

    static func haloPin(
        core: UIColor,
        symbol: String?,
        letter: String? = nil,
        size: CGFloat,
        scale: CGFloat,
        ringColor: UIColor? = nil
    ) -> UIImage {
        let canvasWidth = size + pinShadowPadding * 2
        let canvasHeight = size + pinTailHeight + pinShadowPadding
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: canvasWidth * scale, height: canvasHeight * scale))
        return renderer.image { context in
            context.cgContext.scaleBy(x: scale, y: scale)
            drawHaloPinBody(
                core: core,
                symbol: symbol,
                letter: letter,
                size: size,
                origin: CGPoint(x: pinShadowPadding, y: pinShadowPadding),
                context: context,
                ringColor: ringColor
            )
        }
    }

    static func drawHaloPinBody(
        core coreColor: UIColor,
        symbol: String?,
        letter: String?,
        size: CGFloat,
        origin: CGPoint,
        context: UIGraphicsImageRendererContext,
        ringColor: UIColor? = nil
    ) {
        let haloRect = CGRect(x: origin.x, y: origin.y, width: size, height: size)
        // 테두리(cream halo 링) width 축소 → 줄인 만큼 색상 코어가 커짐
        let haloInset: CGFloat = max(size * 0.05, 1.5)
        let coreRect = haloRect.insetBy(dx: haloInset, dy: haloInset)

        // Tail (cream, behind halo so it appears as continuation of halo edge)
        let tailTipY = origin.y + size + pinTailHeight - 0.5
        let tailBaseY = origin.y + size - 2
        let tailHalfWidth: CGFloat = max(size * 0.13, 4)
        let tail = UIBezierPath()
        tail.move(to: CGPoint(x: origin.x + size / 2 - tailHalfWidth, y: tailBaseY))
        tail.addLine(to: CGPoint(x: origin.x + size / 2 + tailHalfWidth, y: tailBaseY))
        tail.addLine(to: CGPoint(x: origin.x + size / 2, y: tailTipY))
        tail.close()

        context.cgContext.saveGState()
        // 2D 느낌: 얕고 흐린 그림자만 유지 (지도 위 가독성용)
        context.cgContext.setShadow(
            offset: CGSize(width: 0, height: 1),
            blur: 2.5,
            color: FestivalDesign.uiNavy.withAlphaComponent(0.16).cgColor
        )
        FestivalDesign.uiCream.setFill()
        tail.fill()
        UIBezierPath(ovalIn: haloRect).fill()
        context.cgContext.restoreGState()

        // Faint halo outline
        FestivalDesign.uiNavy.withAlphaComponent(0.08).setStroke()
        let haloOutline = UIBezierPath(ovalIn: haloRect)
        haloOutline.lineWidth = 0.75
        haloOutline.stroke()

        // Optional prominent ring (used for sponsored pins)
        if let ringColor {
            let ringRect = haloRect.insetBy(dx: -1.2, dy: -1.2)
            let ring = UIBezierPath(ovalIn: ringRect)
            ringColor.setStroke()
            ring.lineWidth = 2.4
            ring.stroke()
        }

        // Core
        coreColor.setFill()
        UIBezierPath(ovalIn: coreRect).fill()

        // Symbol or letter
        if let symbol, let image = UIImage(systemName: symbol) {
            let iconSize = size * 0.42
            let iconRect = CGRect(
                x: coreRect.midX - iconSize / 2,
                y: coreRect.midY - iconSize / 2,
                width: iconSize,
                height: iconSize
            )
            image.withTintColor(FestivalDesign.uiOnPinFill(coreColor), renderingMode: .alwaysOriginal).draw(in: iconRect)
        } else if let letter, !letter.isEmpty {
            let paragraph = NSMutableParagraphStyle()
            paragraph.alignment = .center
            let attributes: [NSAttributedString.Key: Any] = [
                .font: FestivalDesign.uiFont(size: size * 0.46, weight: .heavy),
                .foregroundColor: FestivalDesign.uiOnPinFill(coreColor),
                .paragraphStyle: paragraph
            ]
            let textSize = (letter as NSString).size(withAttributes: attributes)
            let textRect = CGRect(
                x: coreRect.midX - textSize.width / 2,
                y: coreRect.midY - textSize.height / 2,
                width: textSize.width,
                height: textSize.height
            )
            NSString(string: letter).draw(in: textRect, withAttributes: attributes)
        }
    }
}
