import CoreLocation
import SwiftUI

struct NearbyParkingMapView: View {
    let destination: Destination
    let recommendations: [ParkingRecommendation]
    @EnvironmentObject private var router: Router
    @State private var mapCenter: CLLocationCoordinate2D
    @State private var selectedLotID: String?

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

    var body: some View {
        ZStack(alignment: .bottom) {
            KakaoParkingMapView(
                center: mapCenter,
                zoomLevel: 16,
                pins: pins,
                selectedPinID: selectedLotID.map { "parking-\($0)" },
                onTap: { selectedLotID = nil },
                onPinTap: { pin, _ in
                    if case .parking(let lot) = pin.kind {
                        selectedLotID = lot.id
                    }
                },
                onCameraIdle: { _ in }
            )
            .ignoresSafeArea(edges: .bottom)

            if recommendations.isEmpty {
                emptyState
            } else {
                NearbyParkingCardCarousel(
                    recommendations: recommendations,
                    selectedLotID: $selectedLotID,
                    onDetail: { recommendation in
                        router.showDetail(destination: destination, parkingLot: recommendation.parkingLot)
                    },
                    onNavigate: { recommendation in
                        router.startNavigation(destination: destination, parkingLot: recommendation.parkingLot)
                    }
                )
            }
        }
        .festivalNavigationTitle(destination.name)
        .onChange(of: selectedLotID) { newID in
            guard let newID, let lot = recommendations.first(where: { $0.parkingLot.id == newID })?.parkingLot else { return }
            mapCenter = CLLocationCoordinate2D(latitude: lot.lat, longitude: lot.lng)
        }
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

/// 카드 중심 좌표(가로 스크롤 좌표계 기준)를 카드 id별로 모아 "화면 중앙에 가장 가까운 카드"를 찾는 데 쓴다.
private struct CardCenterOffsetKey: PreferenceKey {
    static var defaultValue: [String: CGFloat] = [:]
    static func reduce(value: inout [String: CGFloat], nextValue: () -> [String: CGFloat]) {
        value.merge(nextValue()) { _, new in new }
    }
}

/// 양방향 동기화 가로 스크롤 카드 목록.
/// - 핀을 탭해 `selectedLotID`가 바뀌면 해당 카드로 자동 스크롤한다.
/// - 사용자가 직접 스크롤해 카드가 중앙에 오면 `selectedLotID`를 갱신해 지도 포커스가 따라온다.
private struct NearbyParkingCardCarousel: View {
    let recommendations: [ParkingRecommendation]
    @Binding var selectedLotID: String?
    let onDetail: (ParkingRecommendation) -> Void
    let onNavigate: (ParkingRecommendation) -> Void

    private let cardWidth: CGFloat = 272
    private let cardSpacing: CGFloat = 12

    @State private var containerWidth: CGFloat = 0
    @State private var isSnapping = false

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: cardSpacing) {
                    ForEach(recommendations) { recommendation in
                        NearbyParkingMapCard(
                            recommendation: recommendation,
                            isSelected: recommendation.parkingLot.id == selectedLotID,
                            onDetail: { onDetail(recommendation) },
                            onNavigate: { onNavigate(recommendation) }
                        )
                        .frame(width: cardWidth)
                        .id(recommendation.parkingLot.id)
                        .background(
                            GeometryReader { geo in
                                Color.clear.preference(
                                    key: CardCenterOffsetKey.self,
                                    value: [recommendation.parkingLot.id: geo.frame(in: .named("parkingCarousel")).midX]
                                )
                            }
                        )
                    }
                }
                .padding(.horizontal, max((containerWidth - cardWidth) / 2, 16))
                .padding(.vertical, 10)
            }
            .coordinateSpace(name: "parkingCarousel")
            .background(
                GeometryReader { geo in
                    Color.clear
                        .onAppear { containerWidth = geo.size.width }
                        .onChange(of: geo.size.width) { containerWidth = $0 }
                }
            )
            .onPreferenceChange(CardCenterOffsetKey.self) { offsets in
                guard !isSnapping, containerWidth > 0, !offsets.isEmpty else { return }
                let center = containerWidth / 2
                if let nearest = offsets.min(by: { abs($0.value - center) < abs($1.value - center) }),
                   nearest.key != selectedLotID {
                    selectedLotID = nearest.key
                }
            }
            .onChange(of: selectedLotID) { newID in
                guard let newID else { return }
                isSnapping = true
                withAnimation(.easeInOut(duration: 0.25)) {
                    proxy.scrollTo(newID, anchor: .center)
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    isSnapping = false
                }
            }
        }
        .frame(height: 150)
    }
}

private struct NearbyParkingMapCard: View {
    let recommendation: ParkingRecommendation
    let isSelected: Bool
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
                .stroke(isSelected ? FestivalDesign.coral : FestivalDesign.creamDeep.opacity(0.45), lineWidth: isSelected ? 2 : 1)
        )
        .shadow(color: FestivalDesign.navy.opacity(isSelected ? 0.22 : 0.14), radius: isSelected ? 16 : 12, y: 6)
    }
}
