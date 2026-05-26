import CoreLocation
import KakaoMapsSDK
import SwiftUI
import UIKit

struct KakaoParkingMapView: UIViewRepresentable {
    let center: CLLocationCoordinate2D
    let zoomLevel: Int
    let pins: [MapPinItem]
    let onTap: () -> Void
    let onPinTap: (MapPinItem, CGPoint?) -> Void
    let onCameraIdle: (MapViewport) -> Void
    var onCameraWillMove: (() -> Void)? = nil
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
        context.coordinator.onTap = onTap
        context.coordinator.onPinTap = onPinTap
        context.coordinator.onCameraIdle = onCameraIdle
        context.coordinator.onCameraWillMove = onCameraWillMove
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
        context.coordinator.onTap = onTap
        context.coordinator.onPinTap = onPinTap
        context.coordinator.onCameraIdle = onCameraIdle
        context.coordinator.onCameraWillMove = onCameraWillMove
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
        private var observers: [NSObjectProtocol] = []
        private var poiTapHandlers: [DisposableEventHandler] = []
        private var cameraStoppedEventHandler: DisposableEventHandler?
        private var cameraStartedEventHandler: DisposableEventHandler?
        private var registeredDynamicStyleIDs: Set<String> = []
        private var suppressDiscoverLabelsAfterGesture = false
        private var showAllDiscoverLabelsAfterZoomIn = false

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
                    showsAllDiscoverLabels: showsAllDiscoverLabels
                )
            }
            if renderedPinSnapshot != pinSnapshot {
                renderPins(on: mapView)
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
                zOrder: 20
            )
            _ = manager.addLabelLayer(option: layerOption)

            manager.addPoiStyle(makeStyle(id: "current-location", image: .currentLocationPin))
            manager.addPoiStyle(makeStyle(id: "destination", image: .destinationPin))
            manager.addPoiStyle(makeStyle(id: "parking-available", image: .parkingPin(FestivalDesign.uiTeal)))
            manager.addPoiStyle(makeStyle(id: "parking-moderate", image: .parkingPin(FestivalDesign.uiLantern)))
            manager.addPoiStyle(makeStyle(id: "parking-busy", image: .parkingPin(FestivalDesign.uiCoral)))
            manager.addPoiStyle(makeStyle(id: "parking-stale", image: .parkingPin(.systemGray)))
            for style in DiscoverPinStyle.allCases {
                manager.addPoiStyle(makeStyle(
                    id: style.id,
                    image: .discoverPin(fill: style.fill, symbol: style.symbol, prominent: style.isProminent)
                ))
            }
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

        private func makeStyle(id: String, image: UIImage) -> PoiStyle {
            let iconStyle = PoiIconStyle(symbol: image, anchorPoint: CGPoint(x: 0.5, y: 1.0))
            return PoiStyle(styleID: id, styles: [
                PerLevelPoiStyle(iconStyle: iconStyle, level: 0)
            ])
        }

        private func renderPins(on mapView: KakaoMap) {
            let manager = mapView.getLabelManager()
            guard let layer = manager.getLabelLayer(layerID: "parking-pins") else { return }
            poiTapHandlers = []
            layer.clearAllItems()

            for pin in latestPins {
                let styleID = pin.styleID(
                    showsDiscoverLabel: showsDiscoverLabels,
                    showsAllDiscoverLabels: showsAllDiscoverLabels
                )
                if !registeredDynamicStyleIDs.contains(styleID),
                   let style = pin.dynamicDiscoverStyleIDAndImage(styleID: styleID) {
                    manager.addPoiStyle(makeStyle(id: style.id, image: style.image))
                    registeredDynamicStyleIDs.insert(style.id)
                }
                let option = PoiOptions(styleID: styleID, poiID: pin.poiID)
                option.rank = rank(for: pin.kind)
                option.clickable = true
                let point = MapPoint(longitude: pin.coordinate.longitude, latitude: pin.coordinate.latitude)
                let poi = layer.addPoi(option: option, at: point)
                if let handler = poi?.addPoiTappedEventHandler(
                    target: self,
                    handler: KakaoParkingMapView.Coordinator.poiTappedHandler
                ) {
                    poiTapHandlers.append(handler)
                }
                poi?.show()
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

    init(pin: MapPinItem, showsDiscoverLabels: Bool, showsAllDiscoverLabels: Bool) {
        id = pin.id
        coordinate = pin.coordinate
        styleID = pin.styleID(
            showsDiscoverLabel: showsDiscoverLabels,
            showsAllDiscoverLabels: showsAllDiscoverLabels
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

private extension MapPinItem {
    var poiID: String {
        id.map { character in
            character.isLetter || character.isNumber || character == "-" || character == "_" ? character : "_"
        }
        .reduce(into: "") { result, character in
            result.append(character)
        }
    }

    func styleID(showsDiscoverLabel: Bool = false, showsAllDiscoverLabels: Bool = false) -> String {
        switch kind {
        case .currentLocation:
            return "current-location"
        case .destination:
            return "destination"
        case .parking(let parkingLot):
            if parkingLot.stale {
                return "parking-stale"
            } else {
                switch parkingLot.congestionStatus {
                case .available:
                    return "parking-available"
                case .moderate:
                    return "parking-moderate"
                case .busy, .full:
                    return "parking-busy"
                case .unknown:
                    return "parking-stale"
                }
            }
        case .festival(let festival):
            let style = DiscoverPinStyle.festivalStyle(for: festival)
            guard showsDiscoverLabel && (showsTitleLabel || showsAllDiscoverLabels) else { return style.id }
            return style.labeledID(for: festival.title)
        case .event(let event):
            let style = DiscoverPinStyle.eventStyle(for: event)
            guard showsDiscoverLabel && (showsTitleLabel || showsAllDiscoverLabels) else { return style.id }
            return style.labeledID(for: event.title)
        case .cluster(let cluster):
            return "cluster-\(cluster.count)-\(cluster.tint.stableStyleKey)"
        }
    }

    func dynamicDiscoverStyleIDAndImage(styleID: String) -> (id: String, image: UIImage)? {
        switch kind {
        case .festival(let festival):
            let style = DiscoverPinStyle.festivalStyle(for: festival)
            guard styleID == style.labeledID(for: festival.title) else { return nil }
            return (styleID, .discoverPin(fill: style.fill, symbol: style.symbol, label: festival.title.shortMapLabel))
        case .event(let event):
            let style = DiscoverPinStyle.eventStyle(for: event)
            guard styleID == style.labeledID(for: event.title) else { return nil }
            return (styleID, .discoverPin(
                fill: style.fill,
                symbol: style.symbol,
                label: event.title.shortMapLabel,
                prominent: style.isProminent
            ))
        case .cluster(let cluster):
            guard styleID == "cluster-\(cluster.count)-\(cluster.tint.stableStyleKey)" else { return nil }
            return (styleID, .clusterPin(fill: cluster.tint, count: cluster.count, scale: UIImage.mapPinScale))
        default:
            return nil
        }
    }

}

private extension CongestionStatus {
    var clusterColor: UIColor {
        switch self {
        case .available:
            return FestivalDesign.uiTeal
        case .moderate:
            return FestivalDesign.uiLantern
        case .busy, .full:
            return FestivalDesign.uiCoral
        case .unknown:
            return .systemGray
        }
    }
}

private enum DiscoverPinStyle: CaseIterable {
    case festivalDefault
    case festivalNight
    case festivalNature
    case festivalFood
    case festivalPerformance
    case eventDefault
    case eventExhibition
    case eventPerformance
    case eventEducation
    case eventMarket
    case eventSports
    case eventSponsored

    var id: String {
        switch self {
        case .festivalDefault:
            return "festival-default"
        case .festivalNight:
            return "festival-night"
        case .festivalNature:
            return "festival-nature"
        case .festivalFood:
            return "festival-food"
        case .festivalPerformance:
            return "festival-performance"
        case .eventDefault:
            return "event-default"
        case .eventExhibition:
            return "event-exhibition"
        case .eventPerformance:
            return "event-performance"
        case .eventEducation:
            return "event-education"
        case .eventMarket:
            return "event-market"
        case .eventSports:
            return "event-sports"
        case .eventSponsored:
            return "event-sponsored"
        }
    }

    var fill: UIColor {
        switch self {
        case .festivalDefault:
            return FestivalDesign.uiCoral
        case .festivalNight:
            return FestivalDesign.uiNavy
        case .festivalNature:
            return FestivalDesign.uiTeal
        case .festivalFood:
            return FestivalDesign.uiLantern
        case .festivalPerformance:
            return UIColor(red: 0.93, green: 0.33, blue: 0.54, alpha: 1)
        case .eventDefault:
            return FestivalDesign.uiTeal
        case .eventExhibition:
            return UIColor(red: 0.40, green: 0.70, blue: 0.82, alpha: 1)
        case .eventPerformance:
            return FestivalDesign.uiCoral
        case .eventEducation:
            return FestivalDesign.uiParkingBlue
        case .eventMarket:
            return UIColor(red: 0.66, green: 0.45, blue: 0.24, alpha: 1)
        case .eventSports:
            return UIColor(red: 0.12, green: 0.55, blue: 0.74, alpha: 1)
        case .eventSponsored:
            return UIColor(red: 0.97, green: 0.45, blue: 0.18, alpha: 1)
        }
    }

    var symbol: String {
        switch self {
        case .festivalDefault:
            return "sparkles"
        case .festivalNight:
            return "moon.stars.fill"
        case .festivalNature:
            return "leaf.fill"
        case .festivalFood:
            return "fork.knife"
        case .festivalPerformance:
            return "music.note"
        case .eventDefault:
            return "calendar"
        case .eventExhibition:
            return "paintpalette.fill"
        case .eventPerformance:
            return "theatermasks.fill"
        case .eventEducation:
            return "book.fill"
        case .eventMarket:
            return "bag.fill"
        case .eventSports:
            return "figure.run"
        case .eventSponsored:
            return "star.fill"
        }
    }

    var isProminent: Bool {
        if case .eventSponsored = self { return true }
        return false
    }

    func labeledID(for title: String) -> String {
        "\(id)-label-\(title.stableStyleKey)"
    }

    static func festivalStyle(for festival: Festival) -> DiscoverPinStyle {
        let text = [festival.title, festival.subtitle, festival.venueName, festival.address]
            .compactMap { $0 }
            .joined(separator: " ")
            .appending(" \(festival.tags.joined(separator: " "))")
            .lowercased()

        if text.containsAny(["밤", "야간", "달빛", "빛", "라이트", "light", "night"]) {
            return .festivalNight
        }
        if text.containsAny(["숲", "정원", "꽃", "벚꽃", "장미", "자연", "생태", "garden", "flower"]) {
            return .festivalNature
        }
        if text.containsAny(["푸드", "음식", "먹거리", "맥주", "와인", "커피", "food", "beer", "wine"]) {
            return .festivalFood
        }
        if text.containsAny(["음악", "뮤직", "공연", "콘서트", "재즈", "락", "페스티벌", "music", "concert", "jazz"]) {
            return .festivalPerformance
        }
        return .festivalDefault
    }

    static func eventStyle(for event: FreeEvent) -> DiscoverPinStyle {
        if event.isSponsored {
            return .eventSponsored
        }
        let text = [event.title, event.eventType, event.storeName, event.address, event.benefit, event.shortDescription]
            .compactMap { $0 }
            .joined(separator: " ")
            .lowercased()

        if text.containsAny(["전시", "미술", "갤러리", "박물관", "뮤지엄", "exhibition", "gallery", "museum", "art"]) {
            return .eventExhibition
        }
        if text.containsAny(["공연", "음악", "콘서트", "연극", "무용", "국악", "performance", "concert", "theater", "dance"]) {
            return .eventPerformance
        }
        if text.containsAny(["교육", "강좌", "체험", "워크숍", "클래스", "education", "workshop", "class"]) {
            return .eventEducation
        }
        if text.containsAny(["장터", "마켓", "시장", "플리", "market", "fair"]) {
            return .eventMarket
        }
        if text.containsAny(["스포츠", "체육", "러닝", "걷기", "마라톤", "sports", "running", "marathon"]) {
            return .eventSports
        }
        return .eventDefault
    }

}

private extension String {
    func containsAny(_ needles: [String]) -> Bool {
        needles.contains { contains($0) }
    }

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

    static var currentLocationPin: UIImage {
        haloPin(core: FestivalDesign.uiParkingBlue, symbol: nil, size: 28, scale: mapPinScale, dotted: true)
    }

    static var destinationPin: UIImage {
        haloPin(core: FestivalDesign.uiCoral, symbol: "flag.fill", size: 38, scale: mapPinScale)
    }

    static func parkingPin(_ color: UIColor) -> UIImage {
        haloPin(core: color, symbol: nil, letter: "P", size: 32, scale: mapPinScale)
    }

    static func discoverPin(fill: UIColor, symbol: String, label: String? = nil, prominent: Bool = false) -> UIImage {
        discoverMarker(
            fill: fill,
            symbol: symbol,
            label: label,
            size: prominent ? 44 : 34,
            scale: mapPinScale,
            ringColor: prominent ? UIColor(red: 1.0, green: 0.83, blue: 0.25, alpha: 1) : nil
        )
    }

    static func clusterPin(fill: UIColor, count: Int, scale: CGFloat) -> UIImage {
        let size: CGFloat = 34
        let badgeSize: CGFloat = 18
        let canvasWidth = size + pinShadowPadding * 2 + badgeSize * 0.35
        let canvasHeight = size + pinTailHeight + pinShadowPadding + badgeSize * 0.25
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: canvasWidth * scale, height: canvasHeight * scale))
        return renderer.image { context in
            context.cgContext.scaleBy(x: scale, y: scale)
            let origin = CGPoint(x: pinShadowPadding, y: pinShadowPadding + badgeSize * 0.12)
            drawHaloPinBody(
                core: fill,
                symbol: "circle.grid.2x2.fill",
                letter: nil,
                dotted: false,
                size: size,
                origin: origin,
                context: context
            )

            let badgeText = count > 99 ? "99+" : "\(count)"
            let badgeRect = CGRect(
                x: origin.x + size - badgeSize * 0.62,
                y: origin.y - badgeSize * 0.24,
                width: badgeSize,
                height: badgeSize
            )
            let badge = UIBezierPath(ovalIn: badgeRect)
            context.cgContext.saveGState()
            context.cgContext.setShadow(
                offset: CGSize(width: 0, height: 1.5),
                blur: 4,
                color: FestivalDesign.uiNavy.withAlphaComponent(0.25).cgColor
            )
            FestivalDesign.uiCoral.setFill()
            badge.fill()
            context.cgContext.restoreGState()
            UIColor.white.withAlphaComponent(0.95).setStroke()
            badge.lineWidth = 1.4
            badge.stroke()

            let paragraph = NSMutableParagraphStyle()
            paragraph.alignment = .center
            let attributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: count > 99 ? 7.2 : 9.2, weight: .heavy),
                .foregroundColor: UIColor.white,
                .paragraphStyle: paragraph
            ]
            NSString(string: badgeText).draw(in: badgeRect.insetBy(dx: 1, dy: 3.3), withAttributes: attributes)
        }
    }

    static func discoverMarker(
        fill: UIColor,
        symbol: String,
        label: String?,
        size: CGFloat,
        scale: CGFloat,
        ringColor: UIColor? = nil
    ) -> UIImage {
        guard let label, !label.isEmpty else {
            return haloPin(core: fill, symbol: symbol, size: size, scale: scale, ringColor: ringColor)
        }

        let font = UIFont.systemFont(ofSize: 14, weight: .semibold)
        let horizontalPadding: CGFloat = 9
        let bubbleHeight: CGFloat = 24
        let gap: CGFloat = 4
        let labelWidth = ceil((label as NSString).size(withAttributes: [.font: font]).width + horizontalPadding * 2)
        let bubbleWidth = min(labelWidth, 128)
        let pinCanvasWidth = size + pinShadowPadding * 2
        let canvasWidth = max(pinCanvasWidth, bubbleWidth + pinShadowPadding * 2)
        let canvasHeight = bubbleHeight + gap + size + pinTailHeight

        let renderer = UIGraphicsImageRenderer(size: CGSize(width: canvasWidth * scale, height: canvasHeight * scale))
        return renderer.image { context in
            context.cgContext.scaleBy(x: scale, y: scale)

            let bubbleRect = CGRect(x: (canvasWidth - bubbleWidth) / 2, y: 2, width: bubbleWidth, height: bubbleHeight)
            let bubble = UIBezierPath(roundedRect: bubbleRect, cornerRadius: 11)
            context.cgContext.saveGState()
            context.cgContext.setShadow(
                offset: CGSize(width: 0, height: 1.5),
                blur: 4,
                color: FestivalDesign.uiNavy.withAlphaComponent(0.22).cgColor
            )
            FestivalDesign.uiCream.setFill()
            bubble.fill()
            context.cgContext.restoreGState()
            fill.withAlphaComponent(0.65).setStroke()
            bubble.lineWidth = 1.2
            bubble.stroke()

            let paragraph = NSMutableParagraphStyle()
            paragraph.alignment = .center
            paragraph.lineBreakMode = .byTruncatingTail
            let attributes: [NSAttributedString.Key: Any] = [
                .font: font,
                .foregroundColor: FestivalDesign.uiNavy,
                .paragraphStyle: paragraph
            ]
            NSString(string: label).draw(
                in: bubbleRect.insetBy(dx: horizontalPadding, dy: 3),
                withAttributes: attributes
            )

            let pinOriginX = (canvasWidth - size) / 2
            drawHaloPinBody(
                core: fill,
                symbol: symbol,
                letter: nil,
                dotted: false,
                size: size,
                origin: CGPoint(x: pinOriginX, y: bubbleHeight + gap),
                context: context,
                ringColor: ringColor
            )
        }
    }

    static func haloPin(
        core: UIColor,
        symbol: String?,
        letter: String? = nil,
        size: CGFloat,
        scale: CGFloat,
        dotted: Bool = false,
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
                dotted: dotted,
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
        dotted: Bool,
        size: CGFloat,
        origin: CGPoint,
        context: UIGraphicsImageRendererContext,
        ringColor: UIColor? = nil
    ) {
        let haloRect = CGRect(x: origin.x, y: origin.y, width: size, height: size)
        let haloInset: CGFloat = max(size * 0.105, 3)
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
        context.cgContext.setShadow(
            offset: CGSize(width: 0, height: 2.5),
            blur: 5,
            color: FestivalDesign.uiNavy.withAlphaComponent(0.28).cgColor
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
        if dotted {
            coreColor.withAlphaComponent(0.22).setFill()
            UIBezierPath(ovalIn: coreRect).fill()
            let dotRect = coreRect.insetBy(dx: coreRect.width * 0.28, dy: coreRect.height * 0.28)
            coreColor.setFill()
            UIBezierPath(ovalIn: dotRect).fill()
        } else {
            coreColor.setFill()
            UIBezierPath(ovalIn: coreRect).fill()
        }

        // Glossy highlight (top-left)
        let glossRect = CGRect(
            x: coreRect.minX + coreRect.width * 0.16,
            y: coreRect.minY + coreRect.height * 0.12,
            width: coreRect.width * 0.55,
            height: coreRect.height * 0.32
        )
        UIColor.white.withAlphaComponent(0.28).setFill()
        UIBezierPath(ovalIn: glossRect).fill()

        // Symbol or letter
        if let symbol, let image = UIImage(systemName: symbol) {
            let iconSize = size * 0.42
            let iconRect = CGRect(
                x: coreRect.midX - iconSize / 2,
                y: coreRect.midY - iconSize / 2,
                width: iconSize,
                height: iconSize
            )
            image.withTintColor(.white, renderingMode: .alwaysOriginal).draw(in: iconRect)
        } else if let letter, !letter.isEmpty {
            let paragraph = NSMutableParagraphStyle()
            paragraph.alignment = .center
            let attributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: size * 0.46, weight: .heavy),
                .foregroundColor: UIColor.white,
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
