import SwiftUI

/// 큰 위젯: "이번 주 축제 캘린더". 월~일 날짜 스트립 아래에 날짜별 축제를 묶어 보여준다.
struct LargeFestivalWidgetView: View {
    let entry: UpcomingFestivalsEntry

    private static let maxRows = 5

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            weekStrip
            sections
            Spacer(minLength: 0)
            footer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .padding(14)
    }

    private var header: some View {
        HStack(spacing: 4) {
            Text("이번 주 축제")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(FestivalDesign.navy)
            Spacer(minLength: 0)
            Text(entry.basisLabel)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(FestivalDesign.coralText)
                .lineLimit(1)
        }
    }

    private var weekStrip: some View {
        HStack(spacing: 4) {
            ForEach(weekDays, id: \.self) { day in
                dayPill(day)
            }
        }
    }

    private func dayPill(_ day: Date) -> some View {
        let key = FestivalDateSupport.dayKey(day)
        let isToday = key == FestivalDateSupport.dayKey(entry.date)
        let hasFestival = entry.items.contains { $0.startDate <= key && $0.endDate >= key }

        return VStack(spacing: 1) {
            Text(WidgetFormat.weekdaySymbol(day))
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(isToday ? Color.white : FestivalDesign.secondaryText)
            Text("\(FestivalDateSupport.calendar.component(.day, from: day))")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(isToday ? Color.white : FestivalDesign.navy)
            Circle()
                .fill(isToday ? Color.white : FestivalDesign.teal)
                .frame(width: 4, height: 4)
                .opacity(hasFestival ? 1 : 0)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 5)
        .background(isToday ? FestivalDesign.coral : FestivalDesign.cream.opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: 9))
    }

    private var sections: some View {
        VStack(alignment: .leading, spacing: 7) {
            ForEach(buckets) { bucket in
                VStack(alignment: .leading, spacing: 4) {
                    Text(bucket.label)
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(FestivalDesign.secondaryText)
                    ForEach(bucket.festivals, id: \.id) { festival in
                        Link(destination: WidgetFormat.deepLink(festival)) {
                            FestivalWidgetRow(
                                festival: festival,
                                now: entry.date,
                                basis: entry.basisKind,
                                thumbnailSize: 34
                            )
                        }
                    }
                }
            }
        }
    }

    private var footer: some View {
        HStack(spacing: 4) {
            Link(destination: DeepLinkRouter.shared.urlForCalendar()) {
                Text("캘린더에서 전체 보기")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(FestivalDesign.coralText)
            }
            Spacer(minLength: 0)
            if let staleText = WidgetFormat.staleText(generatedAt: entry.generatedAt, now: entry.date) {
                Text(staleText)
                    .font(.system(size: 9))
                    .foregroundStyle(FestivalDesign.secondaryText)
            }
        }
        .lineLimit(1)
    }

    /// 오늘이 속한 주의 월~일.
    private var weekDays: [Date] {
        let calendar = FestivalDateSupport.calendar
        let today = calendar.startOfDay(for: entry.date)
        let weekday = calendar.component(.weekday, from: today)
        let offsetToMonday = -(((weekday - 2) + 7) % 7)
        guard let monday = calendar.date(byAdding: .day, value: offsetToMonday, to: today) else { return [today] }
        return (0..<7).compactMap { calendar.date(byAdding: .day, value: $0, to: monday) }
    }

    /// 날짜별 묶음. 축제는 이번 주 안에서 처음 걸리는 날짜에 한 번만 넣고,
    /// 이번 주에 걸치지 않는 축제는 시작일 기준으로 뒤에 붙인다. 총 노출은 가독성 상한까지만.
    private var buckets: [WidgetDayBucket] {
        var assigned = Set<String>()
        var result: [WidgetDayBucket] = []
        var remainingSlots = Self.maxRows

        for day in weekDays {
            guard remainingSlots > 0 else { break }
            let key = FestivalDateSupport.dayKey(day)
            let matched = entry.items.filter { festival in
                !assigned.contains(festival.id) && festival.startDate <= key && festival.endDate >= key
            }
            guard !matched.isEmpty else { continue }
            let take = Array(matched.prefix(remainingSlots))
            for festival in take { assigned.insert(festival.id) }
            remainingSlots -= take.count
            result.append(WidgetDayBucket(id: key, label: WidgetFormat.dayText(key), festivals: take))
        }

        if remainingSlots > 0 {
            let upcoming = entry.items
                .filter { !assigned.contains($0.id) }
                .sorted { $0.startDate < $1.startDate }
                .prefix(remainingSlots)
            var grouped: [String: [Festival]] = [:]
            for festival in upcoming {
                grouped[festival.startDate, default: []].append(festival)
            }
            for key in grouped.keys.sorted() {
                result.append(WidgetDayBucket(
                    id: "next-\(key)",
                    label: WidgetFormat.dayText(key),
                    festivals: grouped[key] ?? []
                ))
            }
        }
        return result
    }
}

private struct WidgetDayBucket: Identifiable {
    let id: String
    let label: String
    let festivals: [Festival]
}
