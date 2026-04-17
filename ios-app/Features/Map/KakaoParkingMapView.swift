import CoreLocation
import KakaoMapsSDK
import SwiftUI
import UIKit

struct KakaoParkingMapView: UIViewRepresentable {
    let center: CLLocationCoordinate2D
    let zoomLevel: Int
    let pins: [MapPinItem]
    let onTap: () -> Void
    let onPinTap: (MapPinItem) -> Void

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
        var onPinTap: ((MapPinItem) -> Void)?

        private weak var container: KMViewContainer?
        private var enginePrepared = false
        private var engineActive = false
        private var mapReady = false
        private var stylesReady = false
        private var renderedCamera: MapCameraTarget?
        private var renderedPinSnapshot: [MapPinSnapshot] = []
        private var observers: [NSObjectProtocol] = []
        private var poiTapHandlers: [DisposableEventHandler] = []
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
        }

        @objc func handleTap(_ gesture: UITapGestureRecognizer) {
            if let tappedPin = pin(at: gesture.location(in: container)) {
                suppressDiscoverLabelsAfterGesture = false
                onPinTap?(tappedPin)
                return
            }
            onTap?()
        }

        @objc func handlePinch(_ gesture: UIPinchGestureRecognizer) {
            guard gesture.state == .ended || gesture.state == .cancelled else { return }
            if gesture.scale > 1.06 {
                updateDiscoverLabelVisibility(suppressLabels: false, showAllLabels: true)
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
            render()
        }

        @objc func addViewFailed(_ viewName: String, viewInfoName: String) {
            mapReady = false
        }

        @objc func containerDidResized(_ size: CGSize) {
            updateMapRect(size: size)
        }

        @objc func authenticationFailed(_ errorCode: Int, desc: String) {
            print("KakaoMapsSDK authentication failed: \(errorCode) \(desc)")
        }

        func render() {
            guard mapReady, let mapView = controller?.getView("mapview") as? KakaoMap else { return }
            updateMapRect()
            configureLabelsIfNeeded()
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
            !suppressDiscoverLabelsAfterGesture && (latestCamera.zoomLevel >= 15 || showAllDiscoverLabelsAfterZoomIn)
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
            manager.addPoiStyle(makeStyle(id: "parking-available", image: .parkingPin(.systemGreen)))
            manager.addPoiStyle(makeStyle(id: "parking-moderate", image: .parkingPin(.systemOrange)))
            manager.addPoiStyle(makeStyle(id: "parking-busy", image: .parkingPin(.systemRed)))
            manager.addPoiStyle(makeStyle(id: "parking-stale", image: .parkingPin(.systemGray)))
            for style in DiscoverPinStyle.allCases {
                manager.addPoiStyle(makeStyle(id: style.id, image: .discoverPin(fill: style.fill, symbol: style.symbol)))
            }
            stylesReady = true
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
            onPinTap?(tappedPin)
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
            }
        }
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
            return (styleID, .discoverPin(fill: style.fill, symbol: style.symbol, label: event.title.shortMapLabel))
        default:
            return nil
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
        }
    }

    var fill: UIColor {
        switch self {
        case .festivalDefault:
            return .systemPurple
        case .festivalNight:
            return .systemIndigo
        case .festivalNature:
            return .systemGreen
        case .festivalFood:
            return .systemOrange
        case .festivalPerformance:
            return .systemPink
        case .eventDefault:
            return .systemTeal
        case .eventExhibition:
            return .systemMint
        case .eventPerformance:
            return .systemRed
        case .eventEducation:
            return .systemBlue
        case .eventMarket:
            return .systemBrown
        case .eventSports:
            return .systemCyan
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
        }
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
        let text = [event.title, event.eventType, event.venueName, event.address, event.shortDescription]
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

private extension CLLocationCoordinate2D {
    func isClose(to other: CLLocationCoordinate2D) -> Bool {
        abs(latitude - other.latitude) <= 0.000001 &&
            abs(longitude - other.longitude) <= 0.000001
    }
}

private extension UIImage {
    static var mapPinScale: CGFloat { 0.5 }

    static var currentLocationPin: UIImage {
        circularPin(fill: .systemBlue, symbol: nil, size: 28, scale: mapPinScale)
    }

    static var destinationPin: UIImage {
        circularPin(fill: .systemRed, symbol: "flag.fill", size: 38, scale: mapPinScale)
    }

    static func parkingPin(_ color: UIColor) -> UIImage {
        parkingMarker(fill: color, size: 32, scale: mapPinScale)
    }

    static func discoverPin(fill: UIColor, symbol: String, label: String? = nil) -> UIImage {
        discoverMarker(fill: fill, symbol: symbol, label: label, size: 34, scale: mapPinScale)
    }

    static func discoverMarker(fill: UIColor, symbol: String, label: String?, size: CGFloat, scale: CGFloat) -> UIImage {
        guard let label, !label.isEmpty else {
            return circularPin(fill: fill, symbol: symbol, size: size, scale: scale)
        }

        let font = UIFont.systemFont(ofSize: 14, weight: .semibold)
        let horizontalPadding: CGFloat = 8
        let bubbleHeight: CGFloat = 24
        let gap: CGFloat = 3
        let labelWidth = ceil((label as NSString).size(withAttributes: [.font: font]).width + horizontalPadding * 2)
        let bubbleWidth = min(labelWidth, 124)
        let canvasWidth = max(size, bubbleWidth)
        let canvasHeight = bubbleHeight + gap + size + 9

        let renderer = UIGraphicsImageRenderer(size: CGSize(width: canvasWidth * scale, height: canvasHeight * scale))
        return renderer.image { context in
            context.cgContext.scaleBy(x: scale, y: scale)

            let bubbleRect = CGRect(x: (canvasWidth - bubbleWidth) / 2, y: 0, width: bubbleWidth, height: bubbleHeight)
            let bubble = UIBezierPath(roundedRect: bubbleRect, cornerRadius: 8)
            UIColor.systemBackground.withAlphaComponent(0.92).setFill()
            bubble.fill()
            fill.withAlphaComponent(0.9).setStroke()
            bubble.lineWidth = 1.5
            bubble.stroke()

            let paragraph = NSMutableParagraphStyle()
            paragraph.alignment = .center
            paragraph.lineBreakMode = .byTruncatingTail
            let attributes: [NSAttributedString.Key: Any] = [
                .font: font,
                .foregroundColor: UIColor.label,
                .paragraphStyle: paragraph
            ]
            NSString(string: label).draw(
                in: bubbleRect.insetBy(dx: horizontalPadding, dy: 3),
                withAttributes: attributes
            )

            let pinOriginX = (canvasWidth - size) / 2
            drawCircularPinBody(
                fill: fill,
                symbol: symbol,
                size: size,
                origin: CGPoint(x: pinOriginX, y: bubbleHeight + gap),
                context: context
            )
        }
    }

    static func circularPin(fill: UIColor, symbol: String?, size: CGFloat, scale: CGFloat) -> UIImage {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: size * scale, height: (size + 9) * scale))
        return renderer.image { context in
            context.cgContext.scaleBy(x: scale, y: scale)
            drawCircularPinBody(fill: fill, symbol: symbol, size: size, origin: .zero, context: context)
        }
    }

    static func drawCircularPinBody(fill: UIColor, symbol: String?, size: CGFloat, origin: CGPoint, context: UIGraphicsImageRendererContext) {
        let rect = CGRect(x: origin.x + 2, y: origin.y + 2, width: size - 4, height: size - 4)
        fill.setFill()
        UIBezierPath(ovalIn: rect).fill()

        UIColor.white.setStroke()
        let outline = UIBezierPath(ovalIn: rect)
        outline.lineWidth = 3
        outline.stroke()

        let triangle = UIBezierPath()
        triangle.move(to: CGPoint(x: origin.x + size / 2 - 5, y: origin.y + size - 4))
        triangle.addLine(to: CGPoint(x: origin.x + size / 2 + 5, y: origin.y + size - 4))
        triangle.addLine(to: CGPoint(x: origin.x + size / 2, y: origin.y + size + 7))
        triangle.close()
        fill.setFill()
        triangle.fill()

        guard let symbol, let image = UIImage(systemName: symbol) else { return }
        let iconSize = size * 0.48
        let iconRect = CGRect(
            x: origin.x + (size - iconSize) / 2,
            y: origin.y + (size - iconSize) / 2,
            width: iconSize,
            height: iconSize
        )
        UIColor.white.setFill()
        image.withTintColor(.white, renderingMode: .alwaysOriginal).draw(in: iconRect)
    }

    static func parkingMarker(fill: UIColor, size: CGFloat, scale: CGFloat) -> UIImage {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: size * scale, height: (size + 9) * scale))
        return renderer.image { context in
            context.cgContext.scaleBy(x: scale, y: scale)
            let rect = CGRect(x: 2, y: 2, width: size - 4, height: size - 4)

            fill.setFill()
            UIBezierPath(ovalIn: rect).fill()

            UIColor.white.setStroke()
            let outline = UIBezierPath(ovalIn: rect)
            outline.lineWidth = 2.5
            outline.stroke()

            let triangle = UIBezierPath()
            triangle.move(to: CGPoint(x: size / 2 - 4.5, y: size - 5))
            triangle.addLine(to: CGPoint(x: size / 2 + 4.5, y: size - 5))
            triangle.addLine(to: CGPoint(x: size / 2, y: size + 6))
            triangle.close()
            fill.setFill()
            triangle.fill()

            let paragraph = NSMutableParagraphStyle()
            paragraph.alignment = .center
            let attributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: size * 0.45, weight: .heavy),
                .foregroundColor: UIColor.white,
                .paragraphStyle: paragraph
            ]
            let textRect = CGRect(x: 0, y: 6, width: size, height: size * 0.55)
            NSString(string: "P").draw(in: textRect, withAttributes: attributes)
        }
    }
}
