import WidgetKit
import SwiftUI

struct UpcomingFestivalsEntry: TimelineEntry {
    let date: Date
    let items: [Festival]
}

struct UpcomingFestivalsProvider: TimelineProvider {
    func placeholder(in context: Context) -> UpcomingFestivalsEntry {
        UpcomingFestivalsEntry(date: Date(), items: WidgetSampleData.items)
    }

    func getSnapshot(in context: Context, completion: @escaping (UpcomingFestivalsEntry) -> Void) {
        let items = loadCachedItems()
        completion(UpcomingFestivalsEntry(date: Date(), items: items.isEmpty ? WidgetSampleData.items : items))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<UpcomingFestivalsEntry>) -> Void) {
        let entry = UpcomingFestivalsEntry(date: Date(), items: loadCachedItems())
        let next = Date().addingTimeInterval(30 * 60)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }

    private func loadCachedItems() -> [Festival] {
        let appGroupID = (Bundle.main.object(forInfoDictionaryKey: "APP_GROUP_ID") as? String)
            ?? "group.com.example.ParkingLotNavigator"
        return SharedFestivalCache.load(appGroupID: appGroupID)?.items ?? []
    }
}

struct UpcomingFestivalsWidget: Widget {
    let kind: String = "UpcomingFestivalsWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: UpcomingFestivalsProvider()) { entry in
            UpcomingFestivalsEntryView(entry: entry)
        }
        .configurationDisplayName("다가오는 축제")
        .description("이벤트다에서 가까운 축제 3개를 빠르게 확인하세요.")
        .supportedFamilies([.systemMedium])
    }
}

enum WidgetSampleData {
    static let items: [Festival] = [
        Festival(
            id: "sample-1",
            title: "한강 라이트 페스티벌",
            subtitle: "야간 산책 축제",
            startDate: "2026-05-30",
            endDate: "2026-06-05",
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
            startDate: "2026-06-08",
            endDate: "2026-06-09",
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
            startDate: "2026-06-15",
            endDate: "2026-06-15",
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
}
