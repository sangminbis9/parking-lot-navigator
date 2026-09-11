import Foundation

/// 실패 원인을 사용자가 구분할 수 있는 문구로 바꾼다.
///
/// 예전에는 어느 화면이든 "불러오지 못했습니다" 한 줄이라, 비행기 모드인지 서버가 죽었는지
/// 사용자가 알 수 없었고 다시 시도할 가치가 있는지도 판단할 수 없었다.
enum NetworkErrorMessage {
    /// - Parameter subject: "축제 정보", "주변 주차장"처럼 무엇을 못 불러왔는지. 조사는 여기서 붙인다.
    static func text(for error: Error, subject: String) -> String {
        let object = subject + objectParticle(after: subject)
        guard let urlError = error as? URLError else {
            // 디코딩 실패처럼 응답 자체가 이상한 경우. 원인은 서버 쪽이다.
            return "서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요."
        }
        switch urlError.code {
        case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed, .internationalRoamingOff:
            return "인터넷에 연결되어 있지 않아요. 연결을 확인한 뒤 다시 시도해 주세요."
        case .timedOut, .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed:
            return "응답이 너무 늦어요. 잠시 후 다시 시도해 주세요."
        case .badServerResponse, .cannotParseResponse, .zeroByteResource, .resourceUnavailable:
            return "서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요."
        default:
            return "\(object) 불러오지 못했어요. 잠시 후 다시 시도해 주세요."
        }
    }

    /// 받침이 있으면 "을", 없으면 "를". 한글이 아니면 "를"로 둔다.
    private static func objectParticle(after text: String) -> String {
        guard let last = text.unicodeScalars.last?.value, (0xAC00...0xD7A3).contains(last) else { return "를" }
        return (last - 0xAC00) % 28 == 0 ? "를" : "을"
    }
}
