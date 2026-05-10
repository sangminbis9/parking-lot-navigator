import SwiftUI

struct ParkingDetailView: View {
    let destination: Destination
    let parkingLot: ParkingLot
    @EnvironmentObject private var router: Router
    @EnvironmentObject private var destinationStore: DestinationStore

    private var recommendation: ParkingRecommendation {
        ParkingRecommendationEngine().recommendation(for: parkingLot, destination: destination)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                headerCard
                recommendationCard
                infoCard

                if parkingLot.stale {
                    staleWarningCard
                }

                actionCard
            }
            .padding(16)
        }
        .background(FestivalDesign.background.ignoresSafeArea())
        .navigationTitle("주차장 상세")
    }

    private var headerCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                Image("FestivalMascotGuide")
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
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }

            HStack {
                StatusBadge(text: parkingLot.displayStatus, kind: parkingLot.stale ? .warning : (parkingLot.realtimeAvailable ? .realtime : .neutral))
                StatusBadge(text: parkingLot.source, kind: .source)
            }
        }
        .padding(14)
        .festivalCard()
    }

    private var recommendationCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("추천 이유")
                .font(.headline)
                .foregroundStyle(FestivalDesign.navy)
            HStack {
                Text("추천 점수")
                    .foregroundStyle(.secondary)
                Spacer()
                Text("\(recommendation.scorePercent)점")
                    .font(.headline)
                    .foregroundStyle(FestivalDesign.teal)
            }
            ForEach(recommendation.reasons, id: \.self) { reason in
                Label(reason, systemImage: "checkmark.circle.fill")
                    .font(.subheadline)
                    .foregroundStyle(FestivalDesign.navy)
            }
        }
        .padding(14)
        .festivalCard()
    }

    private var infoCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("주차 정보")
                .font(.headline)
                .foregroundStyle(FestivalDesign.navy)
            detailRow("거리", "\(parkingLot.distanceFromDestinationMeters)m")
            detailRow("총면수", parkingLot.totalCapacity.map(String.init) ?? "정보 없음")
            detailRow("가능 대수", parkingLot.availableSpaces.map(String.init) ?? "정보 없음")
            detailRow("혼잡도", parkingLot.congestionStatus.label)
            detailRow("운영시간", parkingLot.operatingHours ?? "정보 없음")
            detailRow("요금", parkingLot.feeSummary ?? "정보 없음")
        }
        .padding(14)
        .festivalCard()
    }

    private var staleWarningCard: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(FestivalDesign.coral)
            Text("주차 정보 업데이트가 지연되었을 수 있습니다. 현장 상황과 실제 진입 가능 여부를 확인해 주세요.")
                .font(.subheadline)
                .foregroundStyle(FestivalDesign.coral)
        }
        .padding(14)
        .festivalCard()
    }

    private var actionCard: some View {
        VStack(spacing: 10) {
            Button {
                destinationStore.addRecent(destination)
                router.startNavigation(destination: destination, parkingLot: parkingLot)
            } label: {
                Label("경로 미리보기", systemImage: "arrow.triangle.turn.up.right.diamond.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(FestivalDesign.teal)

            Button {
                destinationStore.toggleFavorite(destination)
            } label: {
                Label("목적지 즐겨찾기 추가", systemImage: "star")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .tint(FestivalDesign.navy)
        }
        .padding(14)
        .festivalCard()
    }

    private func detailRow(_ title: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(FestivalDesign.navy)
                .multilineTextAlignment(.trailing)
        }
    }
}
