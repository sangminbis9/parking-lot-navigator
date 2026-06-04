import SwiftUI
import UIKit

enum FestivalTheme: String, CaseIterable, Identifiable {
    case honey
    case peach
    case mint
    case sky
    case lavender
    case crayon

    static let storageKey = "festivalTheme"

    var id: String { rawValue }

    /// 손그림(크레파스) 룩을 쓰는 테마인지. 형태/테두리/그림자/질감 분기에 사용한다.
    var isHandDrawn: Bool { self == .crayon }

    var displayName: String {
        switch self {
        case .honey: return "허니 옐로"
        case .peach: return "피치 코랄"
        case .mint: return "민트 그린"
        case .sky: return "스카이 블루"
        case .lavender: return "라벤더"
        case .crayon: return "크레파스"
        }
    }

    var description: String {
        switch self {
        case .honey: return "따뜻한 기본 축제 톤"
        case .peach: return "부드러운 공연/팝업 톤"
        case .mint: return "산뜻한 야외 이벤트 톤"
        case .sky: return "맑은 가족 나들이 톤"
        case .lavender: return "감성 문화행사 톤"
        case .crayon: return "손그림 스티커북 감성"
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
        case .crayon:
            // 손그림 스티커북 톤: 따뜻한 아이보리/크림 + 오렌지/잎색/코랄 포인트, 차콜브라운 본문.
            return FestivalThemePalette(
                background: Color(red: 1.0, green: 0.973, blue: 0.925),   // #FFF8EC
                surface: Color(red: 1.0, green: 0.992, blue: 0.969),      // #FFFDF7
                cream: Color(red: 1.0, green: 0.957, blue: 0.855),        // #FFF4DA
                creamDeep: Color(red: 0.910, green: 0.788, blue: 0.627),  // #E8C9A0
                coral: Color(red: 0.969, green: 0.608, blue: 0.322),      // #F79B52 (primary)
                lantern: Color(red: 0.949, green: 0.706, blue: 0.255),    // #F2B441
                teal: Color(red: 0.369, green: 0.604, blue: 0.227),       // #5E9A3A (leaf)
                tealSoft: Color(red: 0.918, green: 0.965, blue: 0.847),   // #EAF6D8
                navy: Color(red: 0.184, green: 0.165, blue: 0.141),       // #2F2A24 (charcoal brown)
                secondaryText: Color(red: 0.478, green: 0.416, blue: 0.357), // #7A6A5B
                parkingBlue: Color(red: 0.306, green: 0.518, blue: 0.769),   // #4E84C4
                parkingSoft: Color(red: 0.890, green: 0.933, blue: 0.969)    // #E3EEF7
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

    static var isHandDrawn: Bool { FestivalTheme.current.isHandDrawn }

    static var cardRadius: CGFloat { isHandDrawn ? 18 : 8 }
    static var controlRadius: CGFloat { isHandDrawn ? 14 : 8 }

    /// 손그림 테마의 거친 차콜 외곽선 색. (비손그림 테마에서는 사용하지 않음)
    static var outline: Color { Color(red: 0.176, green: 0.161, blue: 0.145) } // #2D2925

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
        if FestivalDesign.isHandDrawn {
            handDrawnBody(content)
        } else {
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

    // 손그림 카드: 거친 차콜 외곽선 + 블러 없는 오프셋 스티커 그림자.
    private func handDrawnBody(_ content: Content) -> some View {
        let shape = RoughRoundedRectangle(cornerRadius: FestivalDesign.cardRadius)
        return content
            .background(isSelected ? FestivalDesign.tealSoft : FestivalDesign.surface)
            .clipShape(shape)
            .background(
                shape
                    .fill(FestivalDesign.outline.opacity(0.82))
                    .offset(x: 2.5, y: 4)
            )
            .overlay(
                shape
                    .stroke(isSelected ? FestivalDesign.coral : FestivalDesign.outline,
                            lineWidth: isSelected ? 2.6 : 2)
            )
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
