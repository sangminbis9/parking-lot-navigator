import CoreLocation
import SwiftUI

struct NearbyParkingMapView: View {
    let destination: Destination
    let recommendations: [ParkingRecommendation]
    @EnvironmentObject private var router: Router
    @State private var mapCenter: CLLocationCoordinate2D
    @State private var selectedLot: ParkingLot?

    init(destination: Destination, recommendations: [ParkingRecommendation]) {
        self.destination = destination
        self.recommendations = recommendations
        _mapCenter = State(initialValue: CLLocationCoordinate2D(latitude: destination.lat, longitude: destination.lng))
    }

    private var pins: [MapPinItem] {
        var items = [
            MapPinItem(
                id: "destination-\(destination.id)",
                coordinate: CLLocationCoordinate2D(latitude: destination.lat, longitude: destination.lng),
                kind: .destination(destination)
            )
        ]
        items += recommendations.map { recommendation in
            MapPinItem(
                id: "parking-\(recommendation.parkingLot.id)",
                coordinate: CLLocationCoordinate2D(latitude: recommendation.parkingLot.lat, longitude: recommendation.parkingLot.lng),
                kind: .parking(recommendation.parkingLot)
            )
        }
        return items
    }

    private var selectedRecommendation: ParkingRecommendation? {
        guard let selectedLot else { return nil }
        return recommendations.first { $0.parkingLot.id == selectedLot.id }
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            KakaoParkingMapView(
                center: mapCenter,
                zoomLevel: 16,
                pins: pins,
                selectedPinID: selectedLot.map { "parking-\($0.id)" },
                onTap: { selectedLot = nil },
                onPinTap: { pin, _ in
                    if case .parking(let lot) = pin.kind {
                        selectedLot = lot
                    }
                },
                onCameraIdle: { _ in }
            )
            .ignoresSafeArea(edges: .bottom)

            if recommendations.isEmpty {
                emptyState
            } else if let recommendation = selectedRecommendation {
                NearbyParkingMapCard(
                    recommendation: recommendation,
                    onDetail: { router.showDetail(destination: destination, parkingLot: recommendation.parkingLot) },
                    onNavigate: { router.startNavigation(destination: destination, parkingLot: recommendation.parkingLot) }
                )
                .padding(16)
            }
        }
        .festivalNavigationTitle(destination.name)
    }

    private var emptyState: some View {
        Text("주변 주차장을 찾지 못했어요")
            .font(.festival(.subheadline, weight: .semibold))
            .foregroundStyle(FestivalDesign.secondaryText)
            .padding(12)
            .background(FestivalDesign.surface.opacity(0.95))
            .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
            .padding(16)
    }
}

private struct NearbyParkingMapCard: View {
    let recommendation: ParkingRecommendation
    let onDetail: () -> Void
    let onNavigate: () -> Void

    private var parkingLot: ParkingLot { recommendation.parkingLot }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("🅿️ \(parkingLot.name)")
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

            Text("\(recommendation.scorePercent)점 · \(recommendation.primaryReason)")
                .font(.festival(.caption, weight: .semibold))
                .foregroundStyle(FestivalDesign.teal)

            HStack {
                Button("상세") { onDetail() }
                    .buttonStyle(.bordered)
                    .tint(FestivalDesign.navy)
                    .controlSize(.small)
                Button("경로 보기") { onNavigate() }
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
}
