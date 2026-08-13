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
            // 4pt 점은 축제가 몇 개인지도, 어떤 종류인지도 읽히지 않았다.
            // 셀 폭을 채우는 막대로 바꿔 색(카테고리)과 개수를 동시에 보이게 한다.
            HStack(spacing: 2) {
                ForEach(0..<min(festivals.count, 3), id: \.self) { idx in
                    Capsule()
                        .fill(barColor(for: festivals[idx]))
                        .frame(height: 3.5)
                }
                if festivals.count > 3 {
                    Text("+\(festivals.count - 3)")
                        .font(.festival(size: 8, weight: .bold))
                        .foregroundStyle(isSelected ? FestivalDesign.onFill(FestivalDesign.coral) : FestivalDesign.secondaryText)
                        .fixedSize()
                }
            }
            .frame(height: 8)
            .padding(.horizontal, 5)
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
                    .foregroundStyle(isSelected ? FestivalDesign.onFill(FestivalDesign.coral) : FestivalDesign.lanternText)
                    .padding(3)
            }
        }
        .opacity(isCurrentMonth ? 1 : 0.32)
    }

    private var numberColor: Color {
        if isSelected {
            return FestivalDesign.onFill(FestivalDesign.coral)
        }
        if weekdayIndex == 1 {
            return FestivalDesign.coralText
        }
        if weekdayIndex == 7 {
            return FestivalDesign.parkingBlueText
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

    private func barColor(for festival: Festival) -> Color {
        // 선택된 날은 산호색 배경이라 카테고리색을 그대로 얹으면 탁해진다.
        if isSelected {
            return FestivalDesign.onFill(FestivalDesign.coral).opacity(0.85)
        }
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
