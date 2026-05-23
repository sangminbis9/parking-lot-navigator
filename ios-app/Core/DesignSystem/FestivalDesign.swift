import SwiftUI
import UIKit

enum FestivalTheme: String, CaseIterable, Identifiable {
    case honey
    case peach
    case mint
    case sky
    case lavender

    static let storageKey = "festivalTheme"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .honey: return "허니 옐로"
        case .peach: return "피치 코랄"
        case .mint: return "민트 그린"
        case .sky: return "스카이 블루"
        case .lavender: return "라벤더"
        }
    }

    var description: String {
        switch self {
        case .honey: return "따뜻한 기본 축제 톤"
        case .peach: return "부드러운 공연/팝업 톤"
        case .mint: return "산뜻한 야외 이벤트 톤"
        case .sky: return "맑은 가족 나들이 톤"
        case .lavender: return "감성 문화행사 톤"
        }
    }

    var palette: FestivalThemePalette {
        switch self {
        case .honey:
            return FestivalThemePalette(
                background: Color(red: 1.0, green: 0.99, blue: 0.96),
                surface: .white,
                cream: Color(red: 1.0, green: 0.95, blue: 0.78),
                creamDeep: Color(red: 0.92, green: 0.86, blue: 0.74),
                coral: Color(red: 1.0, green: 0.50, blue: 0.40),
                lantern: Color(red: 1.0, green: 0.78, blue: 0.22),
                teal: Color(red: 0.17, green: 0.65, blue: 0.64),
                tealSoft: Color(red: 0.87, green: 0.96, blue: 0.94),
                navy: Color(red: 0.15, green: 0.21, blue: 0.27),
                secondaryText: Color(red: 0.36, green: 0.39, blue: 0.42),
                parkingBlue: Color(red: 0.20, green: 0.42, blue: 0.78),
                parkingSoft: Color(red: 0.89, green: 0.94, blue: 1.0)
            )
        case .peach:
            return FestivalThemePalette(
                background: Color(red: 1.0, green: 0.97, blue: 0.94),
                surface: .white,
                cream: Color(red: 1.0, green: 0.88, blue: 0.83),
                creamDeep: Color(red: 0.91, green: 0.75, blue: 0.68),
                coral: Color(red: 0.91, green: 0.38, blue: 0.31),
                lantern: Color(red: 0.96, green: 0.66, blue: 0.28),
                teal: Color(red: 0.18, green: 0.58, blue: 0.54),
                tealSoft: Color(red: 0.88, green: 0.96, blue: 0.93),
                navy: Color(red: 0.19, green: 0.17, blue: 0.25),
                secondaryText: Color(red: 0.38, green: 0.36, blue: 0.40),
                parkingBlue: Color(red: 0.18, green: 0.40, blue: 0.72),
                parkingSoft: Color(red: 0.90, green: 0.94, blue: 1.0)
            )
        case .mint:
            return FestivalThemePalette(
                background: Color(red: 0.95, green: 0.99, blue: 0.97),
                surface: .white,
                cream: Color(red: 0.80, green: 0.95, blue: 0.89),
                creamDeep: Color(red: 0.63, green: 0.80, blue: 0.74),
                coral: Color(red: 0.88, green: 0.43, blue: 0.34),
                lantern: Color(red: 0.95, green: 0.70, blue: 0.30),
                teal: Color(red: 0.10, green: 0.54, blue: 0.49),
                tealSoft: Color(red: 0.84, green: 0.96, blue: 0.92),
                navy: Color(red: 0.13, green: 0.23, blue: 0.23),
                secondaryText: Color(red: 0.34, green: 0.42, blue: 0.40),
                parkingBlue: Color(red: 0.18, green: 0.43, blue: 0.73),
                parkingSoft: Color(red: 0.90, green: 0.95, blue: 1.0)
            )
        case .sky:
            return FestivalThemePalette(
                background: Color(red: 0.95, green: 0.98, blue: 1.0),
                surface: .white,
                cream: Color(red: 0.82, green: 0.92, blue: 1.0),
                creamDeep: Color(red: 0.66, green: 0.78, blue: 0.90),
                coral: Color(red: 0.88, green: 0.41, blue: 0.49),
                lantern: Color(red: 0.94, green: 0.69, blue: 0.26),
                teal: Color(red: 0.13, green: 0.50, blue: 0.68),
                tealSoft: Color(red: 0.88, green: 0.96, blue: 1.0),
                navy: Color(red: 0.14, green: 0.20, blue: 0.30),
                secondaryText: Color(red: 0.35, green: 0.39, blue: 0.46),
                parkingBlue: Color(red: 0.16, green: 0.38, blue: 0.76),
                parkingSoft: Color(red: 0.88, green: 0.94, blue: 1.0)
            )
        case .lavender:
            return FestivalThemePalette(
                background: Color(red: 0.98, green: 0.96, blue: 1.0),
                surface: .white,
                cream: Color(red: 0.88, green: 0.84, blue: 1.0),
                creamDeep: Color(red: 0.74, green: 0.68, blue: 0.89),
                coral: Color(red: 0.83, green: 0.40, blue: 0.56),
                lantern: Color(red: 0.92, green: 0.68, blue: 0.28),
                teal: Color(red: 0.28, green: 0.50, blue: 0.67),
                tealSoft: Color(red: 0.91, green: 0.93, blue: 1.0),
                navy: Color(red: 0.18, green: 0.16, blue: 0.27),
                secondaryText: Color(red: 0.38, green: 0.36, blue: 0.45),
                parkingBlue: Color(red: 0.25, green: 0.39, blue: 0.74),
                parkingSoft: Color(red: 0.91, green: 0.94, blue: 1.0)
            )
        }
    }

    static var current: FestivalTheme {
        guard let rawValue = UserDefaults.standard.string(forKey: storageKey),
              let theme = FestivalTheme(rawValue: rawValue) else {
            return .honey
        }
        return theme
    }
}

struct FestivalThemePalette {
    let background: Color
    let surface: Color
    let cream: Color
    let creamDeep: Color
    let coral: Color
    let lantern: Color
    let teal: Color
    let tealSoft: Color
    let navy: Color
    let secondaryText: Color
    let parkingBlue: Color
    let parkingSoft: Color
}

final class FestivalThemeStore: ObservableObject {
    @Published var selectedTheme: FestivalTheme {
        didSet {
            UserDefaults.standard.set(selectedTheme.rawValue, forKey: FestivalTheme.storageKey)
        }
    }

    init() {
        selectedTheme = FestivalTheme.current
    }

    func select(_ theme: FestivalTheme) {
        selectedTheme = theme
    }
}

enum FestivalDesign {
    static var palette: FestivalThemePalette { FestivalTheme.current.palette }

    static var background: Color { palette.background }
    static var surface: Color { palette.surface }
    static var cream: Color { palette.cream }
    static var creamDeep: Color { palette.creamDeep }
    static var coral: Color { palette.coral }
    static var lantern: Color { palette.lantern }
    static var teal: Color { palette.teal }
    static var tealSoft: Color { palette.tealSoft }
    static var navy: Color { palette.navy }
    static var secondaryText: Color { palette.secondaryText }
    static var parkingBlue: Color { palette.parkingBlue }
    static var parkingSoft: Color { palette.parkingSoft }

    static let cardRadius: CGFloat = 8
    static let controlRadius: CGFloat = 8

    static var uiCream: UIColor { UIColor(cream) }
    static var uiCoral: UIColor { UIColor(coral) }
    static var uiLantern: UIColor { UIColor(lantern) }
    static var uiTeal: UIColor { UIColor(teal) }
    static var uiNavy: UIColor { UIColor(navy) }
    static var uiParkingBlue: UIColor { UIColor(parkingBlue) }

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

    func festivalNavigationTitle(_ title: String) -> some View {
        self
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text(title)
                        .font(.headline.weight(.bold))
                        .foregroundStyle(FestivalDesign.coral)
                }
            }
            .toolbarBackground(FestivalDesign.surface, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
    }
}
