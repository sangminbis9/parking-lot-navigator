import Foundation

/// "yyyy-MM-dd" 축제 날짜 문자열을 다루는 공용 헬퍼. 앱과 위젯이 같은 기준(Asia/Seoul)으로
/// D-day를 계산하도록 한 곳에 모아 둔다.
enum FestivalDateSupport {
    static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Seoul") ?? .current
        return calendar
    }()

    private static let formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "Asia/Seoul") ?? .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    static func date(from raw: String) -> Date? {
        formatter.date(from: raw)
    }

    static func dayKey(_ date: Date) -> String {
        formatter.string(from: date)
    }

    /// `raw`(축제 날짜)가 `reference` 날짜로부터 며칠 뒤인지. 파싱 실패 시 nil.
    static func daysFromToday(_ raw: String, reference: Date) -> Int? {
        guard let target = date(from: raw), let today = date(from: dayKey(reference)) else { return nil }
        return calendar.dateComponents([.day], from: today, to: target).day
    }
}
