import AppIntents
import Foundation

struct NavigateRecentDestinationIntent: AppIntent {
    static var title: LocalizedStringResource = "최근 목적지로 길안내 시작"
    static var description = IntentDescription("최근 목적지를 선택해 앱에서 주차장 추천과 길안내를 이어갑니다.")
    static var openAppWhenRun = true

    @Parameter(title: "최근 목적지")
    var destination: ParkingDestinationEntity

    func perform() async throws -> some IntentResult {
        SharedDestinationStore.save(
            SharedDestinationDraft(text: destination.name, receivedAt: Date()),
            appGroupID: AppIntentConfiguration.appGroupID
        )
        return .result(dialog: "최근 목적지 \(destination.name) 주변 주차장을 찾습니다.")
    }
}
