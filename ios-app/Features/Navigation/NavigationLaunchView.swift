import SwiftUI
import MapKit
import UIKit
import KakaoSDKNavi

struct NavigationLaunchView: View {
    let destination: Destination
    let parkingLot: ParkingLot
    @State private var estimatedDistanceMeters: CLLocationDistance?
    @State private var estimatedTravelTimeSeconds: TimeInterval?

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text(parkingLot.name)
                        .font(.title2.weight(.bold))
                    Text(parkingLot.address)
                        .foregroundStyle(.secondary)
                    Text("목적지 \(destination.name) 주변 선택 주차장까지의 경로 미리보기입니다.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }

            Section("경로 미리보기") {
                NavigationRoutePreview(destination: destination, parkingLot: parkingLot)
                    .frame(height: 260)
                    .clipShape(RoundedRectangle(cornerRadius: 8))

                LabeledContent("직선 거리", value: "\(parkingLot.distanceFromDestinationMeters)m")
                if let estimatedDistanceMeters {
                    LabeledContent("예상 주행 거리", value: formattedDistance(estimatedDistanceMeters))
                }
                if let estimatedTravelTimeSeconds {
                    LabeledContent("예상 시간", value: formattedDuration(estimatedTravelTimeSeconds))
                }
            }

            Section("주차 정보") {
                LabeledContent("실시간 상태", value: parkingLot.displayStatus)
                LabeledContent("가능 대수", value: parkingLot.availableSpaces.map(String.init) ?? "정보 없음")
                LabeledContent("요금", value: parkingLot.feeSummary ?? "정보 없음")
            }

            Section {
                Button("Apple 지도에서 열기") {
                    openInAppleMaps()
                }
                Button("카카오내비로 열기") {
                    openKakaoNavi()
                }
                .buttonStyle(.borderedProminent)
            } footer: {
                Text("앱 안에서는 경로를 미리 확인하고, 실제 턴바이턴 운전 안내는 외부 내비 앱으로 시작합니다.")
            }
        }
        .navigationTitle("경로 미리보기")
        .task { await loadRouteEstimate() }
    }

    private func loadRouteEstimate() async {
        do {
            let request = MKDirections.Request()
            request.source = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: destination.lat, longitude: destination.lng)))
            request.destination = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: parkingLot.lat, longitude: parkingLot.lng)))
            request.transportType = .automobile
            let response = try await MKDirections(request: request).calculate()
            guard let route = response.routes.first else { return }
            estimatedDistanceMeters = route.distance
            estimatedTravelTimeSeconds = route.expectedTravelTime
        } catch {
            estimatedDistanceMeters = nil
            estimatedTravelTimeSeconds = nil
        }
    }

    private func openInAppleMaps() {
        let item = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: parkingLot.lat, longitude: parkingLot.lng)))
        item.name = parkingLot.name
        item.openInMaps(launchOptions: [
            MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDriving
        ])
    }

    private func openKakaoNavi() {
        let destination = NaviLocation(
            name: parkingLot.name,
            x: String(parkingLot.lng),
            y: String(parkingLot.lat)
        )
        let option = NaviOption(coordType: .WGS84)
        guard let url = NaviApi.shared.navigateUrl(destination: destination, option: option) else {
            UIApplication.shared.open(NaviApi.webNaviInstallUrl)
            return
        }

        if UIApplication.shared.canOpenURL(url) {
            UIApplication.shared.open(url)
        } else {
            UIApplication.shared.open(NaviApi.webNaviInstallUrl)
        }
    }

    private func formattedDistance(_ meters: CLLocationDistance) -> String {
        if meters >= 1000 {
            return String(format: "%.1fkm", meters / 1000)
        }
        return "\(Int(meters))m"
    }

    private func formattedDuration(_ seconds: TimeInterval) -> String {
        let minutes = max(1, Int(seconds / 60))
        return "\(minutes)분"
    }
}

private struct NavigationRoutePreview: View {
    let destination: Destination
    let parkingLot: ParkingLot
    @State private var region: MKCoordinateRegion

    init(destination: Destination, parkingLot: ParkingLot) {
        self.destination = destination
        self.parkingLot = parkingLot
        let center = CLLocationCoordinate2D(
            latitude: (destination.lat + parkingLot.lat) / 2,
            longitude: (destination.lng + parkingLot.lng) / 2
        )
        let latDelta = max(abs(destination.lat - parkingLot.lat) * 2.4, 0.006)
        let lngDelta = max(abs(destination.lng - parkingLot.lng) * 2.4, 0.006)
        _region = State(initialValue: MKCoordinateRegion(
            center: center,
            span: MKCoordinateSpan(latitudeDelta: latDelta, longitudeDelta: lngDelta)
        ))
    }

    var body: some View {
        Map(coordinateRegion: $region, annotationItems: pins) { pin in
            MapMarker(coordinate: pin.coordinate, tint: pin.tint)
        }
    }

    private var pins: [PreviewPin] {
        [
            PreviewPin(id: "destination", coordinate: CLLocationCoordinate2D(latitude: destination.lat, longitude: destination.lng), tint: .red),
            PreviewPin(id: "parking", coordinate: CLLocationCoordinate2D(latitude: parkingLot.lat, longitude: parkingLot.lng), tint: .blue)
        ]
    }
}

private struct PreviewPin: Identifiable {
    let id: String
    let coordinate: CLLocationCoordinate2D
    let tint: Color
}
