import SwiftUI

struct CalendarDayDetailSheet: View {
    let date: Date
    let festivals: [Festival]
    let onSelectFestival: (Festival) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 12) {
                    if festivals.isEmpty {
                        VStack(spacing: 8) {
                            Image(systemName: "calendar.badge.exclamationmark")
                                .font(.system(size: 32))
                                .foregroundStyle(FestivalDesign.secondaryText)
                            Text("이 날에는 축제가 없어요")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(FestivalDesign.secondaryText)
                        }
                        .padding(.top, 60)
                    } else {
                        ForEach(festivals) { festival in
                            Button {
                                onSelectFestival(festival)
                                dismiss()
                            } label: {
                                festivalRow(festival)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(16)
            }
            .background(FestivalDesign.background)
            .navigationTitle(titleText)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("닫기") { dismiss() }
                        .foregroundStyle(FestivalDesign.coral)
                }
            }
        }
    }

    private var titleText: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.dateFormat = "M월 d일 (E)"
        return formatter.string(from: date)
    }

    private func festivalRow(_ festival: Festival) -> some View {
        HStack(alignment: .top, spacing: 12) {
            RoundedRectangle(cornerRadius: 6)
                .fill(festival.status == .ongoing ? FestivalDesign.teal : FestivalDesign.lantern)
                .frame(width: 4)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(festival.status.displayText)
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(festival.status == .ongoing ? FestivalDesign.teal : FestivalDesign.lantern)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(
                            (festival.status == .ongoing ? FestivalDesign.teal : FestivalDesign.lantern).opacity(0.12)
                        )
                        .clipShape(Capsule())
                    Text(festival.startDate == festival.endDate ? festival.startDate : "\(festival.startDate) ~ \(festival.endDate)")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(FestivalDesign.secondaryText)
                }
                Text(festival.title)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(FestivalDesign.navy)
                    .multilineTextAlignment(.leading)
                if let venue = festival.venueName, !venue.isEmpty {
                    Text(venue)
                        .font(.system(size: 12))
                        .foregroundStyle(FestivalDesign.secondaryText)
                }
                Text(festival.address)
                    .font(.system(size: 11))
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .festivalCard()
    }
}
