import SwiftUI
import UIKit

enum FestivalDesign {
    static let background = Color(red: 1.0, green: 0.99, blue: 0.96)
    static let surface = Color.white
    static let cream = Color(red: 1.0, green: 0.95, blue: 0.78)
    static let creamDeep = Color(red: 0.92, green: 0.86, blue: 0.74)
    static let coral = Color(red: 1.0, green: 0.50, blue: 0.40)
    static let lantern = Color(red: 1.0, green: 0.78, blue: 0.22)
    static let teal = Color(red: 0.17, green: 0.65, blue: 0.64)
    static let tealSoft = Color(red: 0.87, green: 0.96, blue: 0.94)
    static let navy = Color(red: 0.15, green: 0.21, blue: 0.27)
    static let secondaryText = Color(red: 0.36, green: 0.39, blue: 0.42)
    static let parkingBlue = Color(red: 0.20, green: 0.42, blue: 0.78)
    static let parkingSoft = Color(red: 0.89, green: 0.94, blue: 1.0)

    static let cardRadius: CGFloat = 8
    static let controlRadius: CGFloat = 8

    static let uiCream = UIColor(red: 1.0, green: 0.95, blue: 0.78, alpha: 1)
    static let uiCoral = UIColor(red: 1.0, green: 0.50, blue: 0.40, alpha: 1)
    static let uiLantern = UIColor(red: 1.0, green: 0.78, blue: 0.22, alpha: 1)
    static let uiTeal = UIColor(red: 0.17, green: 0.65, blue: 0.64, alpha: 1)
    static let uiNavy = UIColor(red: 0.15, green: 0.21, blue: 0.27, alpha: 1)
    static let uiParkingBlue = UIColor(red: 0.20, green: 0.42, blue: 0.78, alpha: 1)

    static func congestionColor(_ status: CongestionStatus) -> Color {
        switch status {
        case .available:
            return teal
        case .moderate:
            return lantern
        case .busy, .full:
            return coral
        case .unknown:
            return secondaryText
        }
    }

    static func uiCongestionColor(_ status: CongestionStatus) -> UIColor {
        switch status {
        case .available:
            return uiTeal
        case .moderate:
            return uiLantern
        case .busy, .full:
            return uiCoral
        case .unknown:
            return .systemGray
        }
    }
}

struct FestivalCardBackground: ViewModifier {
    var isSelected = false

    func body(content: Content) -> some View {
        content
            .background(isSelected ? FestivalDesign.tealSoft : FestivalDesign.surface)
            .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
            .overlay(
                RoundedRectangle(cornerRadius: FestivalDesign.cardRadius)
                    .stroke(isSelected ? FestivalDesign.teal : FestivalDesign.creamDeep.opacity(0.42), lineWidth: isSelected ? 1.5 : 1)
            )
            .shadow(color: FestivalDesign.navy.opacity(isSelected ? 0.11 : 0.06), radius: isSelected ? 10 : 7, y: 3)
    }
}

extension View {
    func festivalCard(isSelected: Bool = false) -> some View {
        modifier(FestivalCardBackground(isSelected: isSelected))
    }
}
