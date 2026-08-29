import Foundation

/// 행사 정보 오류 신고. 로그인이 없는 앱이라 신고자를 식별하는 필드는 두지 않는다.
/// Worker `POST /api/event-reports`의 `eventReportSchema`와 필드가 1:1이다.
struct EventReportSubmission: Encodable, Equatable {
    var eventKind: String   // "festival" | "local_event"
    var eventId: String
    var eventTitle: String?
    var reason: String
    var note: String?
}

enum EventReportReason: String, CaseIterable, Identifiable {
    case ended
    case wrongDate = "wrong_date"
    case wrongPrice = "wrong_price"
    case wrongPlace = "wrong_place"
    case wrongContent = "wrong_content"
    case duplicate
    case etc

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .ended: return "이미 종료된 행사예요"
        case .wrongDate: return "날짜가 잘못됐어요"
        case .wrongPrice: return "가격이 잘못됐어요"
        case .wrongPlace: return "장소가 잘못됐어요"
        case .wrongContent: return "행사 내용이 잘못됐어요"
        case .duplicate: return "같은 행사가 중복으로 보여요"
        case .etc: return "기타"
        }
    }
}
