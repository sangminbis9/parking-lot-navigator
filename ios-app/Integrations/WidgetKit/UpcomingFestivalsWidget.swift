import WidgetKit
import SwiftUI

struct UpcomingFestivalsEntry: TimelineEntry {
    let date: Date
    let items: [Festival]
    /// 캐시가 만들어진 시각. `nil`이면 앱이 아직 한 번도 동기화하지 않은 상태다.
    let generatedAt: Date?
    /// 이 목록을 어떤 기준으로 모았는지. 빈 화면 문구를 가르는 데 쓴다.
    let basisKind: WidgetBasisKind
    let basisLabel: String
    /// 앱에 필터가 걸려 있었는지. "필터를 조정해보세요"를 아무 때나 띄우지 않기 위해 필요하다.
    let hasActiveFilter: Bool

    init(
        date: Date,
        items: [Festival],
        generatedAt: Date?,
        basisKind: WidgetBasisKind = .location,
        basisLabel: String = "내 주변",
        hasActiveFilter: Bool = false
    ) {
        self.date = date
        self.items = items
        self.generatedAt = generatedAt
        self.basisKind = basisKind
        self.basisLabel = basisLabel
        self.hasActiveFilter = hasActiveFilter
    }

    init(date: Date, snapshot: WidgetSnapshot?) {
        self.init(
            date: date,
            items: snapshot?.items ?? [],
            generatedAt: snapshot?.generatedAt,
            basisKind: snapshot?.basisKind ?? .nationwide,
            basisLabel: snapshot?.basisLabel ?? "내 주변",
            hasActiveFilter: snapshot?.hasActiveFilter ?? false
        )
    }
}

struct UpcomingFestivalsProvider: TimelineProvider {
    func placeholder(in context: Context) -> UpcomingFestivalsEntry {
        UpcomingFestivalsEntry(date: Date(), items: WidgetSampleData.items, generatedAt: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (UpcomingFestivalsEntry) -> Void) {
        let snapshot = loadSnapshot()
        // 샘플은 위젯 갤러리 미리보기 전용이다. 실제 홈 화면에 넣으면 가짜 축제가 진짜처럼 보인다.
        if snapshot == nil, context.isPreview {
            completion(UpcomingFestivalsEntry(date: Date(), items: WidgetSampleData.items, generatedAt: Date()))
            return
        }
        completion(UpcomingFestivalsEntry(date: Date(), snapshot: snapshot))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<UpcomingFestivalsEntry>) -> Void) {
        let snapshot = loadSnapshot()
        let now = Date()
        var entries = [UpcomingFestivalsEntry(date: now, snapshot: snapshot)]
        // 캐시를 다시 받지 못해도 자정에는 D-day와 "이번 주" 강조가 하루치 움직여야 한다.
        if let midnight = Self.nextMidnight(after: now) {
            entries.append(UpcomingFestivalsEntry(date: midnight, snapshot: snapshot))
        }
        completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(30 * 60))))
    }

    private static func nextMidnight(after date: Date) -> Date? {
        let calendar = FestivalDateSupport.calendar
        return calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: date))
    }

    private func loadSnapshot() -> WidgetSnapshot? {
        SharedFestivalCache.load(appGroupID: WidgetAppGroup.id)
    }
}

struct UpcomingFestivalsWidget: Widget {
    let kind: String = "UpcomingFestivalsWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: UpcomingFestivalsProvider()) { entry in
            UpcomingFestivalsEntryView(entry: entry)
        }
        .configurationDisplayName("다가오는 축제")
        .description("이벤트다에서 주변과 관심 지역의 다가오는 축제를 빠르게 확인하세요.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

enum WidgetSampleData {
    static let items: [Festival] = [
        Festival(
            id: "sample-1",
            title: "한강 라이트 페스티벌",
            subtitle: "야간 산책 축제",
            startDate: sampleDate(0),
            endDate: sampleDate(3),
            status: .ongoing,
            venueName: "여의도 한강공원",
            address: "서울특별시 영등포구 여의동로 330",
            lat: 37.526,
            lng: 126.933,
            distanceMeters: 1200,
            source: "sample",
            sourceUrl: nil,
            imageUrl: nil,
            tags: ["서울", "야간", "빛"]
        ),
        Festival(
            id: "sample-2",
            title: "성수 푸드마켓",
            subtitle: "동네 푸드 페어",
            startDate: sampleDate(2),
            endDate: sampleDate(3),
            status: .upcoming,
            venueName: "성수동 카페거리",
            address: "서울특별시 성동구 성수이로",
            lat: 37.544,
            lng: 127.055,
            distanceMeters: 4200,
            source: "sample",
            sourceUrl: nil,
            imageUrl: nil,
            tags: ["서울", "푸드"]
        ),
        Festival(
            id: "sample-3",
            title: "북한산 재즈 나이트",
            subtitle: "도심 속 재즈",
            startDate: sampleDate(5),
            endDate: sampleDate(5),
            status: .upcoming,
            venueName: "북한산 자락",
            address: "서울특별시 은평구",
            lat: 37.660,
            lng: 126.964,
            distanceMeters: 6300,
            source: "sample",
            sourceUrl: nil,
            imageUrl: nil,
            tags: ["서울", "음악"]
        )
    ]

    /// 샘플 날짜를 고정값으로 두면 갤러리 미리보기가 늘 "지난 축제"로 보인다.
    private static func sampleDate(_ offsetDays: Int) -> String {
        let base = FestivalDateSupport.calendar.date(byAdding: .day, value: offsetDays, to: Date()) ?? Date()
        return FestivalDateSupport.dayKey(base)
    }
}
