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
        context.coordinator.latestCamera = MapCameraTarget(coordinate: center, zoomLevel: zoomLevel)
        context.coordinator.latestPins = pins
        context.coordinator.onTap = onTap
        context.coordinator.onPinTap = onPinTap
        view.addGestureRecognizer(tap)
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
                onPinTap?(tappedPin)
                return
            }
            onTap?()
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
                moveCamera(on: mapView)
                renderedCamera = latestCamera
            }
            let pinSnapshot = latestPins.map { MapPinSnapshot(pin: $0) }
            if renderedPinSnapshot != pinSnapshot {
                renderPins(on: mapView)
                renderedPinSnapshot = pinSnapshot
            }
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
            manager.addPoiStyle(makeStyle(id: "festival", image: .discoverPin(fill: .systemPurple, symbol: "sparkles")))
            manager.addPoiStyle(makeStyle(id: "event", image: .discoverPin(fill: .systemTeal, symbol: "calendar")))
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
                let option = PoiOptions(styleID: pin.styleID, poiID: pin.id)
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
            guard let tappedPin = latestPins.first(where: { $0.id == param.poiItem.itemID }) else { return }
            onPinTap?(tappedPin)
        }

        private func pin(at touchPoint: CGPoint) -> MapPinItem? {
            guard let mapView = controller?.getView("mapview") as? KakaoMap else { return nil }
            guard let touchedMapPoint = mapView.getPosition(touchPoint) else { return nil }
            let referencePoint = CGPoint(x: touchPoint.x + 36, y: touchPoint.y)
            let referenceMapPoint = mapView.getPosition(referencePoint)
            let touchCoordinate = CLLocationCoordinate2D(
                latitude: touchedMapPoint.wgsCoord.latitude,
                longitude: touchedMapPoint.wgsCoord.longitude
            )
            let touchRadius = referenceMapPoint.map {
                CLLocation(latitude: touchCoordinate.latitude, longitude: touchCoordinate.longitude).distance(
                    from: CLLocation(latitude: $0.wgsCoord.latitude, longitude: $0.wgsCoord.longitude)
                )
            } ?? 80
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

    init(pin: MapPinItem) {
        id = pin.id
        coordinate = pin.coordinate
        styleID = pin.styleID
    }

    static func == (lhs: MapPinSnapshot, rhs: MapPinSnapshot) -> Bool {
        lhs.id == rhs.id &&
            lhs.coordinate.isClose(to: rhs.coordinate) &&
            lhs.styleID == rhs.styleID
    }
}

private extension MapPinItem {
    var styleID: String {
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
        case .festival:
            return "festival"
        case .event:
            return "event"
        }
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

    static func discoverPin(fill: UIColor, symbol: String) -> UIImage {
        circularPin(fill: fill, symbol: symbol, size: 34, scale: mapPinScale)
    }

    static func circularPin(fill: UIColor, symbol: String?, size: CGFloat, scale: CGFloat) -> UIImage {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: size * scale, height: (size + 9) * scale))
        return renderer.image { context in
            context.cgContext.scaleBy(x: scale, y: scale)
            let rect = CGRect(x: 2, y: 2, width: size - 4, height: size - 4)
            let cg = context.cgContext
            cg.setShadow(offset: CGSize(width: 0, height: 2), blur: 4, color: UIColor.black.withAlphaComponent(0.28).cgColor)
            fill.setFill()
            UIBezierPath(ovalIn: rect).fill()

            UIColor.white.setStroke()
            let outline = UIBezierPath(ovalIn: rect)
            outline.lineWidth = 3
            outline.stroke()

            let triangle = UIBezierPath()
            triangle.move(to: CGPoint(x: size / 2 - 5, y: size - 4))
            triangle.addLine(to: CGPoint(x: size / 2 + 5, y: size - 4))
            triangle.addLine(to: CGPoint(x: size / 2, y: size + 7))
            triangle.close()
            fill.setFill()
            triangle.fill()

            guard let symbol, let image = UIImage(systemName: symbol) else { return }
            let iconSize = size * 0.48
            let iconRect = CGRect(
                x: (size - iconSize) / 2,
                y: (size - iconSize) / 2,
                width: iconSize,
                height: iconSize
            )
            UIColor.white.setFill()
            image.withTintColor(.white, renderingMode: .alwaysOriginal).draw(in: iconRect)
        }
    }

    static func parkingMarker(fill: UIColor, size: CGFloat, scale: CGFloat) -> UIImage {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: size * scale, height: (size + 9) * scale))
        return renderer.image { context in
            context.cgContext.scaleBy(x: scale, y: scale)
            let rect = CGRect(x: 2, y: 2, width: size - 4, height: size - 4)
            let cg = context.cgContext
            cg.setShadow(offset: CGSize(width: 0, height: 2), blur: 4, color: UIColor.black.withAlphaComponent(0.26).cgColor)

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
