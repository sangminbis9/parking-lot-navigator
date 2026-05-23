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
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                headerCard

                NavigationRoutePreview(destination: destination, parkingLot: parkingLot)
                    .frame(height: 260)
                    .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
                    .overlay(
                        RoundedRectangle(cornerRadius: FestivalDesign.cardRadius)
                            .stroke(FestivalDesign.creamDeep.opacity(0.45), lineWidth: 1)
                    )

                routeInfoCard
                parkingInfoCard
                actionCard
            }
            .padding(16)
        }
        .background(FestivalDesign.background.ignoresSafeArea())
        .festivalNavigationTitle("경로 미리보기")
        .task { await loadRouteEstimate() }
    }

    private var headerCard: some View {
        HStack(alignment: .top, spacing: 12) {
            Image("FestivalMascotJump")
                .resizable()
                .scaledToFit()
                .frame(width: 58, height: 58)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 5) {
                Text(parkingLot.name)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(FestivalDesign.navy)
                Text(parkingLot.address)
                    .font(.subheadline)
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(2)
                Text("\(destination.name) 방문 전 경로를 확인해요.")
                    .font(.caption)
                    .foregroundStyle(FestivalDesign.secondaryText)
            }
            Spacer()
        }
        .padding(14)
        .festivalCard()
    }

    private var routeInfoCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("경로 정보")
                .font(.headline)
                .foregroundStyle(FestivalDesign.navy)
            infoRow("직선 거리", "\(parkingLot.distanceFromDestinationMeters)m")
            if let estimatedDistanceMeters {
                infoRow("예상 주행 거리", formattedDistance(estimatedDistanceMeters))
            }
            if let estimatedTravelTimeSeconds {
                infoRow("예상 시간", formattedDuration(estimatedTravelTimeSeconds))
            }
        }
        .padding(14)
        .festivalCard()
    }

    private var parkingInfoCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("주차 정보")
                .font(.headline)
                .foregroundStyle(FestivalDesign.navy)
            infoRow("실시간 상태", parkingLot.displayStatus)
            infoRow("가능 대수", parkingLot.availableSpaces.map(String.init) ?? "정보 없음")
            infoRow("요금", parkingLot.feeSummary ?? "정보 없음")
        }
        .padding(14)
        .festivalCard()
    }

    private var actionCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                openInAppleMaps()
            } label: {
                Label("Apple 지도에서 열기", systemImage: "map")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .tint(FestivalDesign.navy)

            Button {
                openKakaoNavi()
            } label: {
                Label("카카오내비로 열기", systemImage: "location.north.line.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(FestivalDesign.teal)

            Text("앱에서는 경로를 미리 확인하고, 실제 이동 전 안내는 선택한 지도 앱에서 시작합니다.")
                .font(.caption)
                .foregroundStyle(FestivalDesign.secondaryText)
        }
        .padding(14)
        .festivalCard()
    }

    private func infoRow(_ title: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .foregroundStyle(FestivalDesign.secondaryText)
            Spacer()
            Text(value)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(FestivalDesign.navy)
                .multilineTextAlignment(.trailing)
        }
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
            MapAnnotation(coordinate: pin.coordinate, anchorPoint: CGPoint(x: 0.5, y: 1.0)) {
                PreviewPinView(pin: pin)
            }
        }
    }

    private var pins: [PreviewPin] {
        [
            PreviewPin(id: "destination", coordinate: CLLocationCoordinate2D(latitude: destination.lat, longitude: destination.lng), tint: FestivalDesign.coral),
            PreviewPin(id: "parking", coordinate: CLLocationCoordinate2D(latitude: parkingLot.lat, longitude: parkingLot.lng), tint: FestivalDesign.parkingBlue)
        ]
    }
}

private struct PreviewPin: Identifiable {
    let id: String
    let coordinate: CLLocationCoordinate2D
    let tint: Color
}

private struct PreviewPinView: View {
    let pin: PreviewPin

    private var symbolName: String? {
        pin.id == "destination" ? "flag.fill" : nil
    }

    var body: some View {
        ZStack(alignment: .top) {
            Circle()
                .fill(pin.tint)
                .frame(width: 16, height: 16)
                .overlay(
                    Circle()
                        .stroke(.white, lineWidth: 1.25)
                )
                .shadow(color: FestivalDesign.navy.opacity(0.24), radius: 2, y: 1)

            Triangle()
                .fill(pin.tint)
                .frame(width: 5, height: 6)
                .offset(y: 13)

            if let symbolName {
                Image(systemName: symbolName)
                    .font(.system(size: 7, weight: .bold))
                    .foregroundStyle(.white)
                    .offset(y: 4)
            } else {
                Text("P")
                    .font(.system(size: 7.2, weight: .heavy))
                    .foregroundStyle(.white)
                    .offset(y: 3.5)
            }
        }
        .frame(width: 16, height: 20.5)
    }
}

private struct Triangle: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}
