import SwiftUI

private let calendarDayCellCalendar = Calendar(identifier: .gregorian)

struct CalendarDayCell: View {
    let date: Date
    let isCurrentMonth: Bool
    let isSelected: Bool
    let festivals: [Festival]
    var isSaved: Bool = false

    private var dayNumber: Int {
        calendarDayCellCalendar.component(.day, from: date)
    }

    private var weekdayIndex: Int {
        calendarDayCellCalendar.component(.weekday, from: date) // 1 = Sunday
    }

    private var isToday: Bool {
        calendarDayCellCalendar.isDateInToday(date)
    }

    var body: some View {
        VStack(spacing: 4) {
            Text("\(dayNumber)")
                .font(.festival(size: 13, weight: isToday ? .bold : .semibold))
                .foregroundStyle(numberColor)
            HStack(spacing: 3) {
                ForEach(0..<min(festivals.count, 3), id: \.self) { idx in
                    Circle()
                        .fill(dotColor(for: festivals[idx]))
                        .frame(width: 4, height: 4)
                }
                if festivals.count > 3 {
                    Text("+")
                        .font(.festival(size: 9, weight: .bold))
                        .foregroundStyle(FestivalDesign.secondaryText)
                }
            }
            .frame(height: 6)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 56)
        .background(background)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(isToday ? FestivalDesign.coral.opacity(0.7) : Color.clear, lineWidth: 1.2)
        )
        .overlay(alignment: .topTrailing) {
            if isSaved {
                Image(systemName: "star.fill")
                    .font(.festival(size: 7, weight: .bold))
                    .foregroundStyle(isSelected ? FestivalDesign.surface : FestivalDesign.lantern)
                    .padding(3)
            }
        }
        .opacity(isCurrentMonth ? 1 : 0.32)
    }

    private var numberColor: Color {
        if isSelected {
            return FestivalDesign.surface
        }
        if weekdayIndex == 1 {
            return FestivalDesign.coral
        }
        if weekdayIndex == 7 {
            return FestivalDesign.parkingBlue
        }
        return FestivalDesign.navy
    }

    private var background: Color {
        if isSelected {
            return FestivalDesign.coral
        }
        if !festivals.isEmpty {
            return FestivalDesign.cream.opacity(0.5)
        }
        return Color.clear
    }

    private func dotColor(for festival: Festival) -> Color {
        if let category = festival.primaryCategory {
            return category.tint
        }
        switch festival.status {
        case .ongoing:
            return FestivalDesign.teal
        case .upcoming:
            return FestivalDesign.lantern
        }
    }
}
