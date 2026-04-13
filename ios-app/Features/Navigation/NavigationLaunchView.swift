import SwiftUI

struct NavigationLaunchView: View {
    let destination: Destination
    let parkingLot: ParkingLot
    @State private var status = "길안내를 준비하고 있습니다."
    private let navigationService: NavigationService = NavigationServiceFactory.make()

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "location.north.line")
                .font(.system(size: 56))
                .foregroundStyle(.blue)
            Text(parkingLot.name)
                .font(.title2.weight(.bold))
            Text("목적지 \(destination.name) 주변 선택 주차장까지 인앱 길안내를 시작합니다.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Text(status)
                .font(.subheadline)
            Button("길안내 시작") {
                Task { await start() }
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
        .navigationTitle("인앱 내비게이션")
        .task { await start() }
    }

    private func start() async {
        do {
            try await navigationService.startNavigation(to: parkingLot, from: destination)
            status = "길안내가 시작되었습니다."
        } catch {
            status = "SDK 초기화 또는 길안내 시작에 실패했습니다. 현재는 mock 길안내로 동작합니다."
        }
    }
}
