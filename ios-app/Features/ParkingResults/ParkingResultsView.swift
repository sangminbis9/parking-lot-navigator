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
        List {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text(destination.name).font(.title2.weight(.bold))
                    Text(destination.address).foregroundStyle(.secondary)
                    StatusBadge(text: "반경 800m", kind: .source)
                }
            }

            Section("지도 미리보기") {
                ZStack {
                    Rectangle().fill(Color.green.opacity(0.08))
                    VStack(spacing: 8) {
                        Image(systemName: "map")
                            .font(.largeTitle)
                        Text("목적지와 주변 주차장 미니맵")
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(height: 160)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }

            if viewModel.isLoading {
                LoadingStateView(text: "주차장을 찾는 중입니다").frame(height: 160)
            } else if let errorMessage = viewModel.errorMessage {
                FailureStateView(message: errorMessage) { Task { await viewModel.load() } }
            } else {
                Section("추천 주차장") {
                    ForEach(viewModel.items) { item in
                        Button {
                            router.showDetail(destination: destination, parkingLot: item)
                        } label: {
                            ParkingLotRow(parkingLot: item)
                        }
                    }
                }
            }
        }
        .navigationTitle("주차 추천")
        .task { await viewModel.load() }
    }
}

struct ParkingLotRow: View {
    let parkingLot: ParkingLot

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(parkingLot.name).font(.headline)
                Spacer()
                Text("\(parkingLot.distanceFromDestinationMeters)m")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Text(parkingLot.address)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            HStack {
                StatusBadge(text: parkingLot.displayStatus, kind: parkingLot.stale ? .warning : (parkingLot.realtimeAvailable ? .realtime : .neutral))
                StatusBadge(text: parkingLot.isPublic ? "공영" : "민영", kind: .source)
                if parkingLot.supportsEv { StatusBadge(text: "EV", kind: .neutral) }
                if parkingLot.supportsAccessible { StatusBadge(text: "교통약자", kind: .neutral) }
            }
        }
        .foregroundStyle(.primary)
    }
}
