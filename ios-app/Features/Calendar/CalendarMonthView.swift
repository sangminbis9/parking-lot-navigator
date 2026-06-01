import SwiftUI

struct CalendarMonthView: View {
    let monthAnchor: Date
    let festivalsByDay: [String: [Festival]]
    let selectedDay: Date?
    let savedDayKeys: Set<String>
    let onSelectDay: (Date) -> Void
    let onSwipeMonth: (Int) -> Void

    private let calendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Seoul") ?? .current
        return cal
    }()
    private let weekdaySymbols = ["일", "월", "화", "수", "목", "금", "토"]

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 0) {
                ForEach(0..<7, id: \.self) { idx in
                    Text(weekdaySymbols[idx])
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(idx == 0 ? FestivalDesign.coral : (idx == 6 ? FestivalDesign.parkingBlue : FestivalDesign.secondaryText))
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(.horizontal, 8)

            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 7), spacing: 4) {
                ForEach(daysInGrid, id: \.id) { entry in
                    if let date = entry.date {
                        let dayKey = CalendarViewModel.dayFormatter.string(from: date)
                        CalendarDayCell(
                            date: date,
                            isCurrentMonth: entry.isInMonth,
                            isSelected: isSameDay(date, selectedDay),
                            festivals: festivalsByDay[dayKey] ?? [],
                            isSaved: savedDayKeys.contains(dayKey)
                        )
                        .onTapGesture {
                            onSelectDay(date)
                        }
                    } else {
                        Color.clear.frame(height: 56)
                    }
                }
            }
            .padding(.horizontal, 8)
        }
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 24)
                .onEnded { value in
                    guard abs(value.translation.width) > abs(value.translation.height) else { return }
                    if value.translation.width < 0 {
                        onSwipeMonth(1)
                    } else if value.translation.width > 0 {
                        onSwipeMonth(-1)
                    }
                }
        )
    }

    private struct DayEntry: Identifiable {
        let id: Int
        let date: Date?
        let isInMonth: Bool
    }

    private var daysInGrid: [DayEntry] {
        guard let monthStart = calendar.dateInterval(of: .month, for: monthAnchor)?.start else {
            return []
        }
        let weekday = calendar.component(.weekday, from: monthStart) // Sunday = 1
        let leadingEmpty = weekday - 1
        let range = calendar.range(of: .day, in: .month, for: monthAnchor) ?? 1..<2
        var entries: [DayEntry] = []
        for i in 0..<leadingEmpty {
            entries.append(DayEntry(id: i, date: nil, isInMonth: false))
        }
        for day in range {
            if let date = calendar.date(byAdding: .day, value: day - 1, to: monthStart) {
                entries.append(DayEntry(id: leadingEmpty + day, date: date, isInMonth: true))
            }
        }
        let trailing = (7 - entries.count % 7) % 7
        for i in 0..<trailing {
            entries.append(DayEntry(id: entries.count + i + 1000, date: nil, isInMonth: false))
        }
        return entries
    }

    private func isSameDay(_ a: Date, _ b: Date?) -> Bool {
        guard let b else { return false }
        return calendar.isDate(a, inSameDayAs: b)
    }
}
