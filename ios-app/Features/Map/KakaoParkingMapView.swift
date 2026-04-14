import CoreLocation
import KakaoMapsSDK
import SwiftUI
import UIKit

struct KakaoParkingMapView: UIViewRepresentable {
    let center: CLLocationCoordinate2D
    let pins: [MapPinItem]

    func makeUIView(context: Context) -> KMViewContainer {
        let view = KMViewContainer()
        view.sizeToFit()
        context.coordinator.createController(view)
        context.coordinator.controller?.prepareEngine()
        return view
    }

    func updateUIView(_ uiView: KMViewContainer, context: Context) {
        context.coordinator.latestCenter = center
        context.coordinator.latestPins = pins
        context.coordinator.controller?.activateEngine()
        context.coordinator.render()
    }

    static func dismantleUIView(_ uiView: KMViewContainer, coordinator: Coordinator) {
        coordinator.controller?.pauseEngine()
        coordinator.controller?.resetEngine()
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    final class Coordinator: NSObject, MapControllerDelegate {
        var controller: KMController?
        var latestCenter = CLLocationCoordinate2D(latitude: 37.5665, longitude: 126.9780)
        var latestPins: [MapPinItem] = []

        private var mapReady = false
        private var stylesReady = false

        func createController(_ view: KMViewContainer) {
            controller = KMController(viewContainer: view)
            controller?.delegate = self
        }

        @objc func addViews() {
            let mapPoint = MapPoint(longitude: latestCenter.longitude, latitude: latestCenter.latitude)
            let info = MapviewInfo(viewName: "mapview", viewInfoName: "map", defaultPosition: mapPoint, defaultLevel: 6)
            controller?.addView(info)
        }

        @objc func addViewSucceeded(_ viewName: String, viewInfoName: String) {
            mapReady = true
            configureLabelsIfNeeded()
            render()
        }

        @objc func addViewFailed(_ viewName: String, viewInfoName: String) {
            mapReady = false
        }

        @objc func containerDidResized(_ size: CGSize) {
            let mapView = controller?.getView("mapview") as? KakaoMap
            mapView?.viewRect = CGRect(origin: .zero, size: size)
        }

        @objc func authenticationFailed(_ errorCode: Int, desc: String) {
            print("KakaoMapsSDK authentication failed: \(errorCode) \(desc)")
        }

        func render() {
            guard mapReady, let mapView = controller?.getView("mapview") as? KakaoMap else { return }
            configureLabelsIfNeeded()
            moveCamera(on: mapView)
            renderPins(on: mapView)
        }

        private func moveCamera(on mapView: KakaoMap) {
            let target = MapPoint(longitude: latestCenter.longitude, latitude: latestCenter.latitude)
            let cameraUpdate = CameraUpdate.make(target: target, zoomLevel: 5, mapView: mapView)
            mapView.moveCamera(cameraUpdate)
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
            manager.addPoiStyle(makeStyle(id: "parking-unknown", image: .parkingPin(.systemBlue)))
            manager.addPoiStyle(makeStyle(id: "parking-stale", image: .parkingPin(.systemGray)))
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
            layer.clearAllItems()

            for pin in latestPins {
                let option = PoiOptions(styleID: styleID(for: pin.kind), poiID: pin.id)
                option.rank = rank(for: pin.kind)
                let point = MapPoint(longitude: pin.coordinate.longitude, latitude: pin.coordinate.latitude)
                let poi = layer.addPoi(option: option, at: point)
                poi?.show()
            }
        }

        private func styleID(for kind: MapPinItem.Kind) -> String {
            switch kind {
            case .currentLocation:
                return "current-location"
            case .destination:
                return "destination"
            case .parking(let parkingLot):
                if parkingLot.stale { return "parking-stale" }
                switch parkingLot.congestionStatus {
                case .available:
                    return "parking-available"
                case .moderate:
                    return "parking-moderate"
                case .busy, .full:
                    return "parking-busy"
                case .unknown:
                    return "parking-unknown"
                }
            }
        }

        private func rank(for kind: MapPinItem.Kind) -> Int {
            switch kind {
            case .currentLocation:
                return 30
            case .destination:
                return 20
            case .parking:
                return 10
            }
        }
    }
}

private extension UIImage {
    static var currentLocationPin: UIImage {
        circularPin(fill: .systemBlue, symbol: nil, size: 28)
    }

    static var destinationPin: UIImage {
        circularPin(fill: .systemRed, symbol: "flag.fill", size: 38)
    }

    static func parkingPin(_ color: UIColor) -> UIImage {
        circularPin(fill: color, symbol: "parkingsign", size: 38)
    }

    static func circularPin(fill: UIColor, symbol: String?, size: CGFloat) -> UIImage {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: size, height: size + 9))
        return renderer.image { context in
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
}
