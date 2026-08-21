import SwiftUI
import UIKit

/// 위젯 확장이 App Group 컨테이너를 찾을 때 쓰는 식별자. 앱과 같은 Info.plist 키를 읽는다.
enum WidgetAppGroup {
    static let id: String = (Bundle.main.object(forInfoDictionaryKey: "APP_GROUP_ID") as? String)
        ?? "group.com.example.ParkingLotNavigator"
}

/// 위젯에 들어가는 짧은 문구를 한 곳에서 만든다. 세 크기가 같은 표기를 쓰게 하려는 목적이다.
enum WidgetFormat {
    static func statusText(_ festival: Festival, now: Date) -> String {
        if festival.status == .ongoing { return "진행 중" }
        guard let days = FestivalDateSupport.daysFromToday(festival.startDate, reference: now) else {
            return festival.status.displayText
        }
        if days <= 0 { return "오늘 시작" }
        if days == 1 { return "내일 시작" }
        return "D-\(days)"
    }

    static func dateRangeText(_ festival: Festival) -> String {
        if festival.startDate == festival.endDate { return dayText(festival.startDate) }
        return "\(dayText(festival.startDate)) ~ \(dayText(festival.endDate))"
    }

    /// "8.21(수)". 파싱이 안 되면 원본을 그대로 둔다.
    static func dayText(_ raw: String) -> String {
        let parts = raw.split(separator: "-")
        guard parts.count == 3 else { return raw }
        let bare = "\(Int(parts[1]) ?? 0).\(Int(parts[2]) ?? 0)"
        guard let date = FestivalDateSupport.date(from: raw) else { return bare }
        return "\(bare)(\(weekdaySymbol(date)))"
    }

    static func weekdaySymbol(_ date: Date) -> String {
        let index = FestivalDateSupport.calendar.component(.weekday, from: date)
        let symbols = ["일", "월", "화", "수", "목", "금", "토"]
        return symbols[(index - 1 + 7) % 7]
    }

    /// 장소 표기. 행사장 이름이 있으면 그것을, 없으면 주소 앞 두 토막(시·구)을 쓴다.
    static func placeText(_ festival: Festival) -> String? {
        if let venue = festival.venueName, !venue.isEmpty { return venue }
        let head = festival.address.split(whereSeparator: { $0.isWhitespace }).prefix(2).joined(separator: " ")
        return head.isEmpty ? nil : head
    }

    /// 지역 필터나 전국 기준일 때 distanceMeters는 조회 중심 기준이라 "가까움"을 뜻하지 않는다.
    static func distanceText(_ festival: Festival, basis: WidgetBasisKind) -> String? {
        guard basis == .location, festival.distanceMeters > 0 else { return nil }
        if festival.distanceMeters < 1000 { return "\(festival.distanceMeters)m" }
        return String(format: "%.1fkm", Double(festival.distanceMeters) / 1000)
    }

    /// 캐시가 3시간 넘게 묵었을 때만 표시한다. 갓 받아온 데이터에 시각을 붙이면 잡음이다.
    static func staleText(generatedAt: Date?, now: Date) -> String? {
        guard let generatedAt else { return nil }
        let elapsed = now.timeIntervalSince(generatedAt)
        guard elapsed >= 3 * 3600 else { return nil }
        let hours = Int(elapsed / 3600)
        if hours >= 24 { return "\(hours / 24)일 전 업데이트" }
        return "\(hours)시간 전 업데이트"
    }

    static func statusColor(_ festival: Festival) -> Color {
        festival.status.chipText
    }

    static func statusDotColor(_ festival: Festival) -> Color {
        festival.status == .ongoing ? FestivalDesign.coral : FestivalDesign.secondaryText
    }

    static func deepLink(_ festival: Festival) -> URL {
        DeepLinkRouter.shared.urlForDestination(id: festival.id)
    }
}

/// 앱이 App Group에 넣어 둔 썸네일을 파일에서 읽는다. 위젯에서는 네트워크 로딩을 하지 않는다.
enum WidgetThumbnailLoader {
    static func image(for festivalID: String) -> UIImage? {
        guard let url = WidgetThumbnailStore.fileURL(festivalID: festivalID, appGroupID: WidgetAppGroup.id),
              let data = try? Data(contentsOf: url) else { return nil }
        return UIImage(data: data)
    }
}

/// 썸네일이 없어도 레이아웃이 무너지지 않도록 같은 크기의 대체 블록을 그린다.
struct FestivalWidgetImage: View {
    let festival: Festival
    var cornerRadius: CGFloat = 8

    var body: some View {
        Group {
            if let image = WidgetThumbnailLoader.image(for: festival.id) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                ZStack {
                    FestivalDesign.cream
                    Image(systemName: "sparkles")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(FestivalDesign.coralText.opacity(0.7))
                }
            }
        }
        .clipped()
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
    }
}

extension View {
    @ViewBuilder
    func containerBackgroundIfAvailable(_ color: Color) -> some View {
        if #available(iOS 17.0, *) {
            self.containerBackground(color, for: .widget)
        } else {
            self.background(color)
        }
    }
}
