import SwiftUI

struct ParkingResultsView: View {
    let destination: Destination
    let apiClient: APIClientProtocol
    @EnvironmentObject private var router: Router
    @StateObject private var viewModel: ParkingResultsViewModel

    init(destination: Destination, apiClient: APIClientProtocol) {
        self.destination = destination
        self.apiClient = apiClient
        _viewModel = StateObject(wrappedValue: ParkingResultsViewModel(destination: destination, apiClient: apiClient))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ParkingGuideHeader(destination: destination)
                routePreviewCard

                if viewModel.isLoading {
                    LoadingStateView(text: "방문할 축제 근처 주차장을 찾는 중입니다")
                        .frame(height: 160)
                        .padding()
                        .festivalCard()
                } else if let errorMessage = viewModel.errorMessage {
                    FailureStateView(message: errorMessage) { Task { await viewModel.load() } }
                        .festivalCard()
                } else {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("추천 주차장")
                            .font(.headline)
                            .foregroundStyle(FestivalDesign.navy)
                        ForEach(viewModel.recommendations) { recommendation in
                            Button {
                                router.showDetail(destination: destination, parkingLot: recommendation.parkingLot)
                            } label: {
                                ParkingLotRow(recommendation: recommendation)
                                    .padding(12)
                                    .festivalCard()
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding(16)
        }
        .background(FestivalDesign.background.ignoresSafeArea())
        .navigationTitle("주차 추천")
        .task { await viewModel.load() }
    }

    private var routePreviewCard: some View {
        ZStack {
            LinearGradient(
                colors: [FestivalDesign.tealSoft, FestivalDesign.cream.opacity(0.65)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            VStack(spacing: 10) {
                Image(systemName: "map")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(FestivalDesign.teal)
                Text("목적지 주변 주차 미리보기")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(FestivalDesign.navy)
                Text("상세 화면에서 경로와 실시간 정보를 이어서 확인할 수 있어요.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding()
        }
        .frame(height: 160)
        .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
        .overlay(
            RoundedRectangle(cornerRadius: FestivalDesign.cardRadius)
                .stroke(FestivalDesign.creamDeep.opacity(0.45), lineWidth: 1)
        )
    }
}

private struct ParkingGuideHeader: View {
    let destination: Destination

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image("FestivalMascotIcon")
                .resizable()
                .scaledToFit()
                .frame(width: 58, height: 58)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 5) {
                Text(destination.name)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(FestivalDesign.navy)
                    .lineLimit(2)
                Text(destination.address)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                StatusBadge(text: "반경 800m", kind: .source)
            }
            Spacer()
        }
        .padding(14)
        .festivalCard()
    }
}

struct ParkingLotRow: View {
    let recommendation: ParkingRecommendation

    private var parkingLot: ParkingLot {
        recommendation.parkingLot
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(parkingLot.name)
                        .font(.headline)
                        .foregroundStyle(FestivalDesign.navy)
                        .lineLimit(2)
                    Text(parkingLot.address)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 3) {
                    Text("\(recommendation.scorePercent)점")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(FestivalDesign.teal)
                    Text("\(parkingLot.distanceFromDestinationMeters)m")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Text(recommendation.primaryReason)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.primary)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    StatusBadge(text: parkingLot.displayStatus, kind: parkingLot.stale ? .warning : (parkingLot.realtimeAvailable ? .realtime : .neutral))
                    StatusBadge(text: parkingLot.isPublic ? "공영" : "민영", kind: .source)
                    ForEach(recommendation.badges.prefix(3), id: \.self) { badge in
                        StatusBadge(text: badge, kind: .neutral)
                    }
                    if parkingLot.supportsEv { StatusBadge(text: "EV", kind: .neutral) }
                    if parkingLot.supportsAccessible { StatusBadge(text: "교통약자", kind: .neutral) }
                }
            }
        }
        .foregroundStyle(.primary)
    }
}
