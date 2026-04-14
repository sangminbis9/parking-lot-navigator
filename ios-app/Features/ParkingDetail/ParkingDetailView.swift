import SwiftUI

struct ParkingDetailView: View {
    let destination: Destination
    let parkingLot: ParkingLot
    @EnvironmentObject private var router: Router
    @EnvironmentObject private var destinationStore: DestinationStore

    var body: some View {
        List {
            Section {
                Text(parkingLot.name).font(.title2.weight(.bold))
                Text(parkingLot.address).foregroundStyle(.secondary)
                HStack {
                    StatusBadge(text: parkingLot.displayStatus, kind: parkingLot.stale ? .warning : (parkingLot.realtimeAvailable ? .realtime : .neutral))
                    StatusBadge(text: parkingLot.source, kind: .source)
                }
            }

            Section("주차 정보") {
                LabeledContent("거리", value: "\(parkingLot.distanceFromDestinationMeters)m")
                LabeledContent("총면수", value: parkingLot.totalCapacity.map(String.init) ?? "정보 없음")
                LabeledContent("가능 대수", value: parkingLot.availableSpaces.map(String.init) ?? "정보 없음")
                LabeledContent("혼잡도", value: parkingLot.congestionStatus.label)
                LabeledContent("운영시간", value: parkingLot.operatingHours ?? "정보 없음")
                LabeledContent("요금", value: parkingLot.feeSummary ?? "정보 없음")
            }

            if parkingLot.stale {
                Section {
                    Text("이 주차 정보는 업데이트가 지연되었을 수 있습니다. 현장 상황과 다를 수 있으니 진입 전 표지판을 확인해 주세요.")
                        .font(.subheadline)
                        .foregroundStyle(.red)
                }
            }

            Section {
                Button("경로 미리보기") {
                    destinationStore.addRecent(destination)
                    router.startNavigation(destination: destination, parkingLot: parkingLot)
                }
                .buttonStyle(.borderedProminent)

                Button("목적지 즐겨찾기 토글") {
                    destinationStore.toggleFavorite(destination)
                }
            }
        }
        .navigationTitle("주차장 상세")
    }
}
