import SwiftUI
import WidgetKit

/// 크기별 위젯의 진입점. 실제 레이아웃은 크기마다 다른 파일이 갖고 있고 여기서는 고르기만 한다.
struct UpcomingFestivalsEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: UpcomingFestivalsEntry

    var body: some View {
        layout
            .containerBackgroundIfAvailable(FestivalDesign.background)
    }

    @ViewBuilder
    private var layout: some View {
        if entry.items.isEmpty {
            WidgetEmptyState(entry: entry, compact: family == .systemSmall)
        } else {
            switch family {
            case .systemSmall:
                if let hero = entry.items.first {
                    SmallFestivalWidgetView(entry: entry, festival: hero)
                }
            case .systemLarge:
                LargeFestivalWidgetView(entry: entry)
            default:
                MediumFestivalWidgetView(entry: entry)
            }
        }
    }
}

#if DEBUG
struct UpcomingFestivalsEntryView_Previews: PreviewProvider {
    private static let sample = UpcomingFestivalsEntry(
        date: Date(),
        items: WidgetSampleData.items,
        generatedAt: Date(),
        basisKind: .location,
        basisLabel: "내 주변",
        hasActiveFilter: false
    )

    private static let emptyRegion = UpcomingFestivalsEntry(
        date: Date(),
        items: [],
        generatedAt: Date().addingTimeInterval(-5 * 3600),
        basisKind: .region,
        basisLabel: "부산",
        hasActiveFilter: true
    )

    static var previews: some View {
        Group {
            UpcomingFestivalsEntryView(entry: sample)
                .previewContext(WidgetPreviewContext(family: .systemSmall))
                .previewDisplayName("Small")
            UpcomingFestivalsEntryView(entry: sample)
                .previewContext(WidgetPreviewContext(family: .systemMedium))
                .previewDisplayName("Medium")
            UpcomingFestivalsEntryView(entry: sample)
                .previewContext(WidgetPreviewContext(family: .systemLarge))
                .previewDisplayName("Large")
            UpcomingFestivalsEntryView(entry: emptyRegion)
                .previewContext(WidgetPreviewContext(family: .systemMedium))
                .previewDisplayName("Empty (region filter)")
        }
    }
}
#endif
