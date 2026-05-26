import SwiftUI
import WidgetKit

struct UpcomingFestivalsEntryView: View {
    let entry: UpcomingFestivalsEntry

    var body: some View {
        if entry.items.isEmpty {
            emptyState
                .containerBackgroundIfAvailable(FestivalDesign.background)
        } else {
            mediumLayout
                .containerBackgroundIfAvailable(FestivalDesign.background)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 6) {
            Image(systemName: "calendar.badge.exclamationmark")
                .font(.system(size: 22))
                .foregroundStyle(FestivalDesign.coral)
            Text("다가오는 축제가 없어요")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(FestivalDesign.navy)
            Text("앱에서 필터를 조정해보세요")
                .font(.system(size: 11))
                .foregroundStyle(FestivalDesign.secondaryText)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var mediumLayout: some View {
        let visible = Array(entry.items.prefix(3))
        return HStack(alignment: .top, spacing: 10) {
            if let hero = visible.first {
                heroCard(hero)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(visible.dropFirst().prefix(2).enumerated()), id: \.offset) { _, festival in
                    rowCard(festival)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .padding(10)
    }

    private func heroCard(_ festival: Festival) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Circle()
                    .fill(festival.status == .ongoing ? FestivalDesign.teal : FestivalDesign.lantern)
                    .frame(width: 5, height: 5)
                Text(festival.status.displayText)
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(festival.status == .ongoing ? FestivalDesign.teal : FestivalDesign.lantern)
            }
            Text(festival.title)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(FestivalDesign.navy)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
            Spacer(minLength: 2)
            Text(formattedRange(festival))
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(FestivalDesign.secondaryText)
            if let venue = festival.venueName, !venue.isEmpty {
                Text(venue)
                    .font(.system(size: 10))
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(1)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(FestivalDesign.surface)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(FestivalDesign.creamDeep.opacity(0.5), lineWidth: 1)
        )
    }

    private func rowCard(_ festival: Festival) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Circle()
                    .fill(festival.status == .ongoing ? FestivalDesign.teal : FestivalDesign.lantern)
                    .frame(width: 4, height: 4)
                Text(festival.title)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(FestivalDesign.navy)
                    .lineLimit(1)
            }
            Text(formattedRange(festival))
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(FestivalDesign.secondaryText)
                .lineLimit(1)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FestivalDesign.cream.opacity(0.45))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func formattedRange(_ festival: Festival) -> String {
        if festival.startDate == festival.endDate {
            return shortDate(festival.startDate)
        }
        return "\(shortDate(festival.startDate)) – \(shortDate(festival.endDate))"
    }

    private func shortDate(_ raw: String) -> String {
        let parts = raw.split(separator: "-")
        guard parts.count == 3 else { return raw }
        return "\(parts[1]).\(parts[2])"
    }
}

private extension View {
    @ViewBuilder
    func containerBackgroundIfAvailable(_ color: Color) -> some View {
        if #available(iOS 17.0, *) {
            self.containerBackground(color, for: .widget)
        } else {
            self.background(color)
        }
    }
}
