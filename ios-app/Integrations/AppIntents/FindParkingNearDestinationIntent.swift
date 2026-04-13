import AppIntents
import Foundation

struct FindParkingNearDestinationIntent: AppIntent {
    static var title: LocalizedStringResource = "목적지 주변 주차 찾기"
    static var description = IntentDescription("목적지 이름이나 주소를 받아 앱에서 주변 주차장을 찾습니다.")
    static var openAppWhenRun = true

    @Parameter(title: "목적지")
    var destinationText: String

    func perform() async throws -> some IntentResult {
        SharedDestinationStore.save(
            SharedDestinationDraft(text: destinationText, receivedAt: Date()),
            appGroupID: AppIntentConfiguration.appGroupID
        )
        return .result(dialog: "목적지 주변 주차장을 찾기 위해 앱을 엽니다.")
    }
}
