import SwiftUI

/// 중간 위젯: "다가오는 축제 TOP 3". 각 줄이 개별 딥링크를 갖는다.
struct MediumFestivalWidgetView: View {
    let entry: UpcomingFestivalsEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            header
            ForEach(visibleItems, id: \.id) { festival in
                Link(destination: WidgetFormat.deepLink(festival)) {
                    FestivalWidgetRow(festival: festival, now: entry.date, basis: entry.basisKind)
                }
            }
            Spacer(minLength: 0)
            footer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .padding(10)
    }

    private var visibleItems: [Festival] {
        Array(entry.items.prefix(3))
    }

    private var header: some View {
        HStack(spacing: 4) {
            Text("다가오는 축제")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(FestivalDesign.navy)
            Spacer(minLength: 0)
            Text(entry.basisLabel)
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(FestivalDesign.coralText)
                .lineLimit(1)
        }
    }

    private var footer: some View {
        HStack(spacing: 4) {
            Text("기준: \(entry.basisLabel)")
                .font(.system(size: 9))
                .foregroundStyle(FestivalDesign.secondaryText)
            Spacer(minLength: 0)
            if let staleText = WidgetFormat.staleText(generatedAt: entry.generatedAt, now: entry.date) {
                Text(staleText)
                    .font(.system(size: 9))
                    .foregroundStyle(FestivalDesign.secondaryText)
            }
        }
        .lineLimit(1)
    }
}
