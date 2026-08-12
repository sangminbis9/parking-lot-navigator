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

    /// 현재 외관(라이트/다크)에 맞는 팔레트. 화면 코드는 항상 이쪽을 쓴다.
    /// 필드마다 라이트/다크 값을 하나로 묶은 동적 색이라, 다크 모드를 토글해도
    /// 뷰가 다시 만들어질 때까지 기다리지 않고 그리는 시점에 바로 새 색으로 풀린다.
    var palette: FestivalThemePalette {
        Self.dynamicPalettes[self] ?? lightPalette
    }

    private static let dynamicPalettes: [FestivalTheme: FestivalThemePalette] = Dictionary(
        uniqueKeysWithValues: FestivalTheme.allCases.map {
            ($0, FestivalThemePalette(light: $0.lightPalette, dark: $0.darkPalette))
        }
    )

    var lightPalette: FestivalThemePalette {
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

    /// 다크 팔레트. 라이트와 같은 필드 이름을 쓰되 역할을 뒤집는다.
    /// - `background`/`surface`/`cream`/`creamDeep`은 어두운 쪽에서 밝아지는 4단 층위(바탕 → 카드 → 강조면 → 테두리).
    /// - `navy`는 본문 텍스트라서 다크에서는 밝은 색이 된다.
    /// - 포인트 색(coral/lantern/teal/parkingBlue)은 어두운 바탕 대비를 위해 라이트보다 밝고 채도를 조금 낮춘다.
    var darkPalette: FestivalThemePalette {
        switch self {
        case .honey:
            return FestivalThemePalette(
                background: Color(red: 0.078, green: 0.071, blue: 0.059),
                surface: Color(red: 0.129, green: 0.118, blue: 0.098),
                cream: Color(red: 0.239, green: 0.208, blue: 0.129),
                creamDeep: Color(red: 0.376, green: 0.337, blue: 0.243),
                coral: Color(red: 1.0, green: 0.573, blue: 0.478),
                lantern: Color(red: 1.0, green: 0.824, blue: 0.376),
                teal: Color(red: 0.365, green: 0.784, blue: 0.769),
                tealSoft: Color(red: 0.125, green: 0.235, blue: 0.227),
                navy: Color(red: 0.949, green: 0.937, blue: 0.910),
                secondaryText: Color(red: 0.675, green: 0.655, blue: 0.616),
                parkingBlue: Color(red: 0.478, green: 0.667, blue: 0.980),
                parkingSoft: Color(red: 0.137, green: 0.184, blue: 0.275)
            )
        case .peach:
            return FestivalThemePalette(
                background: Color(red: 0.086, green: 0.067, blue: 0.063),
                surface: Color(red: 0.145, green: 0.118, blue: 0.110),
                cream: Color(red: 0.259, green: 0.184, blue: 0.161),
                creamDeep: Color(red: 0.400, green: 0.298, blue: 0.267),
                coral: Color(red: 0.976, green: 0.522, blue: 0.451),
                lantern: Color(red: 0.976, green: 0.741, blue: 0.400),
                teal: Color(red: 0.353, green: 0.749, blue: 0.702),
                tealSoft: Color(red: 0.118, green: 0.227, blue: 0.216),
                navy: Color(red: 0.953, green: 0.933, blue: 0.925),
                secondaryText: Color(red: 0.686, green: 0.647, blue: 0.635),
                parkingBlue: Color(red: 0.463, green: 0.655, blue: 0.980),
                parkingSoft: Color(red: 0.137, green: 0.180, blue: 0.275)
            )
        case .mint:
            return FestivalThemePalette(
                background: Color(red: 0.059, green: 0.082, blue: 0.075),
                surface: Color(red: 0.102, green: 0.137, blue: 0.125),
                cream: Color(red: 0.149, green: 0.255, blue: 0.220),
                creamDeep: Color(red: 0.275, green: 0.412, blue: 0.357),
                coral: Color(red: 0.976, green: 0.549, blue: 0.459),
                lantern: Color(red: 0.976, green: 0.757, blue: 0.412),
                teal: Color(red: 0.337, green: 0.808, blue: 0.706),
                tealSoft: Color(red: 0.110, green: 0.243, blue: 0.208),
                navy: Color(red: 0.929, green: 0.961, blue: 0.945),
                secondaryText: Color(red: 0.635, green: 0.714, blue: 0.678),
                parkingBlue: Color(red: 0.463, green: 0.671, blue: 0.980),
                parkingSoft: Color(red: 0.129, green: 0.188, blue: 0.275)
            )
        case .sky:
            return FestivalThemePalette(
                background: Color(red: 0.059, green: 0.075, blue: 0.094),
                surface: Color(red: 0.102, green: 0.125, blue: 0.153),
                cream: Color(red: 0.149, green: 0.220, blue: 0.318),
                creamDeep: Color(red: 0.275, green: 0.357, blue: 0.475),
                coral: Color(red: 0.976, green: 0.537, blue: 0.596),
                lantern: Color(red: 0.976, green: 0.757, blue: 0.400),
                teal: Color(red: 0.357, green: 0.714, blue: 0.894),
                tealSoft: Color(red: 0.110, green: 0.216, blue: 0.278),
                navy: Color(red: 0.929, green: 0.949, blue: 0.976),
                secondaryText: Color(red: 0.655, green: 0.706, blue: 0.776),
                parkingBlue: Color(red: 0.478, green: 0.675, blue: 0.980),
                parkingSoft: Color(red: 0.129, green: 0.188, blue: 0.294)
            )
        case .lavender:
            return FestivalThemePalette(
                background: Color(red: 0.075, green: 0.063, blue: 0.094),
                surface: Color(red: 0.125, green: 0.110, blue: 0.153),
                cream: Color(red: 0.239, green: 0.200, blue: 0.337),
                creamDeep: Color(red: 0.376, green: 0.325, blue: 0.494),
                coral: Color(red: 0.949, green: 0.549, blue: 0.675),
                lantern: Color(red: 0.957, green: 0.745, blue: 0.416),
                teal: Color(red: 0.478, green: 0.675, blue: 0.855),
                tealSoft: Color(red: 0.157, green: 0.169, blue: 0.278),
                navy: Color(red: 0.949, green: 0.937, blue: 0.976),
                secondaryText: Color(red: 0.698, green: 0.667, blue: 0.757),
                parkingBlue: Color(red: 0.518, green: 0.635, blue: 0.980),
                parkingSoft: Color(red: 0.149, green: 0.176, blue: 0.294)
            )
        case .crayon:
            // 밤에 보는 스티커북: 짙은 갈색 종이 위에 밝은 크레파스 색을 얹는다.
            return FestivalThemePalette(
                background: Color(red: 0.098, green: 0.086, blue: 0.071),   // #191612
                surface: Color(red: 0.149, green: 0.129, blue: 0.106),      // #26211B
                cream: Color(red: 0.255, green: 0.212, blue: 0.153),        // #413628
                creamDeep: Color(red: 0.404, green: 0.337, blue: 0.243),    // #67563E
                coral: Color(red: 0.976, green: 0.678, blue: 0.427),        // #F9AD6D
                lantern: Color(red: 0.965, green: 0.769, blue: 0.376),      // #F6C460
                teal: Color(red: 0.541, green: 0.780, blue: 0.404),         // #8AC767 (leaf)
                tealSoft: Color(red: 0.176, green: 0.243, blue: 0.145),     // #2D3E25
                navy: Color(red: 0.965, green: 0.945, blue: 0.906),         // #F6F1E7 (ivory ink)
                secondaryText: Color(red: 0.729, green: 0.671, blue: 0.596), // #BAAB98
                parkingBlue: Color(red: 0.502, green: 0.686, blue: 0.933),   // #80AFEE
                parkingSoft: Color(red: 0.153, green: 0.204, blue: 0.278)    // #273447
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

/// 라이트/다크 선택. 테마와 마찬가지로 UserDefaults를 직접 읽어
/// `FestivalDesign`의 static 색 접근 경로에서 바로 쓸 수 있게 한다.
enum FestivalAppearance {
    static let storageKey = "festivalDarkMode"

    static var isDark: Bool {
        UserDefaults.standard.bool(forKey: storageKey)
    }

    /// 현재 외관의 trait. 지도 핀 비트맵처럼 뷰 계층 밖에서 그릴 때는
    /// 동적 색이 시스템 외관을 따라가 버리므로, 이 trait으로 명시적으로 풀어야 한다.
    static var trait: UITraitCollection {
        UITraitCollection(userInterfaceStyle: isDark ? .dark : .light)
    }

    /// 오프스크린 렌더 캐시 키에 섞는 외관 식별자.
    static var styleKey: String { isDark ? "dark" : "light" }

    /// 라이트/다크 값을 하나의 동적 색으로 묶는다. SwiftUI가 body를 다시 계산하지 않아도
    /// 그리는 시점에 trait에 맞춰 다시 풀리기 때문에, 토글이 화면에 즉시 반영된다.
    static func dynamic(light: Color, dark: Color) -> Color {
        let lightColor = UIColor(light)
        let darkColor = UIColor(dark)
        return Color(UIColor { $0.userInterfaceStyle == .dark ? darkColor : lightColor })
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

extension FestivalThemePalette {
    /// 라이트/다크 팔레트를 필드별 동적 색으로 합친다.
    init(light: FestivalThemePalette, dark: FestivalThemePalette) {
        background = FestivalAppearance.dynamic(light: light.background, dark: dark.background)
        surface = FestivalAppearance.dynamic(light: light.surface, dark: dark.surface)
        cream = FestivalAppearance.dynamic(light: light.cream, dark: dark.cream)
        creamDeep = FestivalAppearance.dynamic(light: light.creamDeep, dark: dark.creamDeep)
        coral = FestivalAppearance.dynamic(light: light.coral, dark: dark.coral)
        lantern = FestivalAppearance.dynamic(light: light.lantern, dark: dark.lantern)
        teal = FestivalAppearance.dynamic(light: light.teal, dark: dark.teal)
        tealSoft = FestivalAppearance.dynamic(light: light.tealSoft, dark: dark.tealSoft)
        navy = FestivalAppearance.dynamic(light: light.navy, dark: dark.navy)
        secondaryText = FestivalAppearance.dynamic(light: light.secondaryText, dark: dark.secondaryText)
        parkingBlue = FestivalAppearance.dynamic(light: light.parkingBlue, dark: dark.parkingBlue)
        parkingSoft = FestivalAppearance.dynamic(light: light.parkingSoft, dark: dark.parkingSoft)
    }
}


final class FestivalThemeStore: ObservableObject {
    @Published var selectedTheme: FestivalTheme {
        didSet {
            UserDefaults.standard.set(selectedTheme.rawValue, forKey: FestivalTheme.storageKey)
        }
    }

    @Published var isDarkMode: Bool {
        didSet {
            UserDefaults.standard.set(isDarkMode, forKey: FestivalAppearance.storageKey)
        }
    }

    init() {
        selectedTheme = FestivalTheme.current
        isDarkMode = FestivalAppearance.isDark
    }

    func select(_ theme: FestivalTheme) {
        selectedTheme = theme
    }

    func setDarkMode(_ enabled: Bool) {
        isDarkMode = enabled
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

    /// 상·하단 바(탭바·네비게이션바) 배경. `surface`는 라이트 테마에서 대부분 흰색이라
    /// 테마를 바꿔도 바가 그대로 보인다. 테마색(cream)을 섞어 바에서도 테마가 드러나게 한다.
    static var barSurface: Color {
        FestivalAppearance.dynamic(
            light: barSurfaceColor(dark: false),
            dark: barSurfaceColor(dark: true)
        )
    }

    /// 바 배경의 테마색 비중. 올리면 테마가 더 뚜렷해지고, 내리면 본문과의 경계가 옅어진다.
    private static let barTintAmount = 0.55

    private static func barSurfaceColor(dark: Bool) -> Color {
        let p = dark ? FestivalTheme.current.darkPalette : FestivalTheme.current.lightPalette
        return mix(p.surface, p.cream, barTintAmount)
    }

    /// 강조색(coral/teal/navy 등)으로 꽉 채운 면 위에 얹는 글자·아이콘 색.
    /// 라이트에서는 흰색이지만, 다크에서는 채움색이 밝아지므로 어두운 바탕색으로 뒤집는다.
    static var onAccent: Color {
        FestivalAppearance.dynamic(light: .white, dark: FestivalTheme.current.darkPalette.background)
    }

    // MARK: - 글자 대비

    /// 강조색을 글자·아이콘으로 쓸 때의 색. 원색 그대로는 밝은 바탕에서 묻히므로
    /// (노란 lantern이 대표적으로 1.5:1까지 떨어진다) 대비 3.3:1을 넘길 때까지 잉크를 섞는다.
    /// 채움색으로 쓸 때는 원색이 그대로 필요하므로 팔레트 값은 건드리지 않고 여기서 파생시킨다.
    static var coralText: Color { readable(coral) }
    static var lanternText: Color { readable(lantern) }
    static var tealText: Color { readable(teal) }
    static var parkingBlueText: Color { readable(parkingBlue) }

    /// 글자가 놓일 수 있는 배경 중 가장 불리한 면. 같은 색이 카드 위에도 바탕 위에도
    /// 올라가므로, 최악의 면 하나를 기준으로 계산해 화면별로 색이 달라지는 것을 막는다.
    private static func textCanvas(dark: Bool) -> Color {
        let theme = FestivalTheme.current
        let cacheKey = theme.rawValue + (dark ? "-dark" : "-light")
        if let cached = canvasCache[cacheKey] { return cached }
        let p = dark ? theme.darkPalette : theme.lightPalette
        let surfaces = [p.background, p.surface, p.cream, p.tealSoft, p.parkingSoft]
        let worst = dark
            ? surfaces.max(by: { luminance($0) < luminance($1) })
            : surfaces.min(by: { luminance($0) < luminance($1) })
        let result = worst ?? p.surface
        canvasCache[cacheKey] = result
        return result
    }

    /// - Parameter color: 팔레트 강조색. 이미 대비가 충분하면 그대로 돌려준다.
    static func readable(_ color: Color) -> Color {
        let key = DerivedKey(color: color, themeID: FestivalTheme.current.rawValue)
        if let cached = readableCache[key] { return cached }
        let result = FestivalAppearance.dynamic(
            light: readableColor(color, dark: false),
            dark: readableColor(color, dark: true)
        )
        readableCache[key] = result
        return result
    }

    private static func readableColor(_ color: Color, dark: Bool) -> Color {
        let source = resolve(color, dark: dark)
        let canvas = textCanvas(dark: dark)
        let inkColor: Color = luminance(canvas) > 0.35 ? .black : .white
        var result = source
        var amount = 0.0
        while amount < 1.0, contrastRatio(result, canvas) < 3.3 {
            amount = min(1.0, amount + 0.05)
            result = mix(source, inkColor, amount)
        }
        return result
    }

    /// 강조색으로 꽉 채운 면 위의 글자색. 흰 글자가 대비 3:1도 못 내는 조합
    /// (노란 lantern 배지가 대표적)에서만 어두운 잉크로 바꾼다.
    static func onFill(_ fill: Color) -> Color {
        let key = DerivedKey(color: fill, themeID: FestivalTheme.current.rawValue)
        if let cached = onFillCache[key] { return cached }
        let result = FestivalAppearance.dynamic(
            light: onFillColor(fill, dark: false),
            dark: onFillColor(fill, dark: true)
        )
        onFillCache[key] = result
        return result
    }

    private static func onFillColor(_ fill: Color, dark: Bool) -> Color {
        let resolvedFill = resolve(fill, dark: dark)
        let base: Color = dark ? FestivalTheme.current.darkPalette.background : .white
        return contrastRatio(base, resolvedFill) >= 3.0 ? base : ink(on: resolvedFill, dark: dark)
    }

    /// 지도 핀 위의 글자·아이콘 색(UIKit 렌더링용). 지도 타일은 다크 모드에서도 밝게 남으므로
    /// 흰 글자를 기준으로 판단하고, 노란 핀처럼 대비가 안 나올 때만 어두운 잉크로 바꾼다.
    static func uiOnPinFill(_ fill: UIColor) -> UIColor {
        let color = Color(fill.resolvedColor(with: FestivalAppearance.trait))
        return contrastRatio(.white, color) >= 3.0
            ? .white
            : UIColor(ink(on: color, dark: FestivalAppearance.isDark))
    }

    /// 채움색 위에서 4.5:1을 낼 때까지 본문색을 검정 쪽으로 섞은 잉크.
    private static func ink(on fill: Color, dark: Bool) -> Color {
        let base = resolve(navy, dark: dark)
        let key = ContrastKey(color: fill, reference: base)
        if let cached = inkCache[key] { return cached }
        var result = base
        var amount = 0.0
        while amount < 1.0, contrastRatio(result, fill) < 4.5 {
            amount = min(1.0, amount + 0.05)
            result = mix(base, .black, amount)
        }
        inkCache[key] = result
        return result
    }

    /// 동적 색을 지정한 외관의 확정 색으로 푼다. 대비 계산은 확정된 RGB가 있어야 성립한다.
    private static func resolve(_ color: Color, dark: Bool) -> Color {
        Color(UIColor(color).resolvedColor(with: UITraitCollection(userInterfaceStyle: dark ? .dark : .light)))
    }

    /// WCAG 상대 명도 기준 대비비(1.0 ~ 21.0).
    static func contrastRatio(_ lhs: Color, _ rhs: Color) -> Double {
        let a = luminance(lhs)
        let b = luminance(rhs)
        return (max(a, b) + 0.05) / (min(a, b) + 0.05)
    }

    private struct ContrastKey: Hashable {
        let color: Color
        let reference: Color
    }

    private struct DerivedKey: Hashable {
        let color: Color
        let themeID: String
    }

    // 팔레트 색은 개수가 정해져 있어 캐시가 무한히 자라지 않는다. 본문(메인 스레드)에서만 읽고 쓴다.
    private static var readableCache: [DerivedKey: Color] = [:]
    private static var onFillCache: [DerivedKey: Color] = [:]
    private static var inkCache: [ContrastKey: Color] = [:]
    private static var canvasCache: [String: Color] = [:]

    private static func components(_ color: Color) -> (r: Double, g: Double, b: Double) {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(color).getRed(&r, green: &g, blue: &b, alpha: &a)
        return (Double(r), Double(g), Double(b))
    }

    private static func luminance(_ color: Color) -> Double {
        let c = components(color)
        func channel(_ value: Double) -> Double {
            value <= 0.03928 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
    }

    private static func mix(_ base: Color, _ target: Color, _ amount: Double) -> Color {
        let b = components(base)
        let t = components(target)
        return Color(
            red: b.r + (t.r - b.r) * amount,
            green: b.g + (t.g - b.g) * amount,
            blue: b.b + (t.b - b.b) * amount
        )
    }

    static var isHandDrawn: Bool { FestivalTheme.current.isHandDrawn }

    static var cardRadius: CGFloat { isHandDrawn ? 18 : 8 }
    static var controlRadius: CGFloat { isHandDrawn ? 14 : 8 }

    /// 화면 전역에서 재사용하는 간격 스케일. 임의의 padding 숫자 대신 이 값을 쓴다.
    enum Spacing {
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 12
        static let lg: CGFloat = 16
        static let xl: CGFloat = 24
        static let xxl: CGFloat = 32
    }

    /// 카드/시트 등에서 쓰는 3단계 그림자(고도). radius/y가 화면마다 제각각 지정되던 것을 통일한다.
    enum Elevation {
        case low
        case medium
        case high

        fileprivate var radius: CGFloat {
            switch self {
            case .low: return 6
            case .medium: return 10
            case .high: return 16
            }
        }

        fileprivate var y: CGFloat {
            switch self {
            case .low: return 2
            case .medium: return 3
            case .high: return 6
            }
        }

        fileprivate var opacity: Double {
            switch self {
            case .low: return 0.06
            case .medium: return 0.10
            case .high: return 0.14
            }
        }
    }

    /// `.shadow(color:radius:y:)`에 그대로 넘길 수 있는 고도 값.
    /// 라이트에서는 `navy` 톤을 쓰지만, 다크에서 `navy`는 본문용 밝은 색이라 그대로 쓰면 그림자가 발광한다.
    /// 다크에서는 검정에 더 높은 불투명도를 써서 카드가 바탕에서 떠 보이게 한다.
    static func shadow(_ level: Elevation) -> (color: Color, radius: CGFloat, y: CGFloat) {
        let color = FestivalAppearance.dynamic(
            light: FestivalTheme.current.lightPalette.navy.opacity(level.opacity),
            dark: Color.black.opacity(min(level.opacity * 3, 0.5))
        )
        return (color, level.radius, level.y)
    }

    /// 앱 전역에서 재사용하는 모션 지속시간. 탭 전환/시트 열닫이 화면마다 다른 숫자를 쓰지 않도록 한다.
    enum Motion {
        /// 탭 전환, 선택 하이라이트 같은 즉각적 피드백.
        static let quick: Double = 0.16
        /// 시트/카드 표시-숨김 등 일반적인 전환.
        static let standard: Double = 0.18
        /// 카드 선택처럼 약간의 탄성이 필요한 전환.
        static let spring = Animation.spring(response: 0.32, dampingFraction: 0.78)
    }

    /// 손그림 테마의 거친 외곽선 색. (비손그림 테마에서는 사용하지 않음)
    /// 라이트는 차콜 크레용, 다크는 어두운 종이 위에 얹는 아이보리 크레용.
    static let outline: Color = FestivalAppearance.dynamic(
        light: Color(red: 0.176, green: 0.161, blue: 0.145), // #2D2925
        dark: Color(red: 0.949, green: 0.918, blue: 0.859)   // #F2EADB
    )

    /// 손그림 카드의 오프셋 스티커 그림자 잉크. 외곽선과 달리 라이트/다크 모두 어둡게 유지한다.
    static let stickerShadowInk: Color = FestivalAppearance.dynamic(
        light: Color(red: 0.176, green: 0.161, blue: 0.145).opacity(0.85),
        dark: Color.black.opacity(0.55)
    )

    /// 버튼/입력 등 컨트롤용 모양. 크레파스 테마에서는 손그림 외곽선, 그 외에는 기존 RoundedRectangle 그대로.
    static var controlShape: AnyShape {
        isHandDrawn
            ? AnyShape(RoughRoundedRectangle(cornerRadius: controlRadius, roughness: 1.4, seed: 29))
            : AnyShape(RoundedRectangle(cornerRadius: controlRadius))
    }

    /// 칩/뱃지용 캡슐 모양. 크레파스 테마에서는 손그림 캡슐(반지름이 높이의 절반으로 클램프됨).
    static var chipShape: AnyShape {
        isHandDrawn
            ? AnyShape(RoughRoundedRectangle(cornerRadius: 400, roughness: 1.2, seed: 41))
            : AnyShape(Capsule())
    }

    // MARK: 크레파스 손글씨 폰트 (개구쟁이체, OFL)

    /// 손글씨 폰트는 같은 포인트 크기에서 작게 보여 +1pt 보정한다.
    static let crayonFontSizeBump: CGFloat = 1

    static func crayonFontName(for weight: Font.Weight) -> String {
        switch weight {
        case .semibold, .bold, .heavy, .black:
            return "Gaegu-Bold"
        default:
            return "Gaegu-Regular"
        }
    }

    static func crayonUIFontName(for weight: UIFont.Weight) -> String {
        weight.rawValue >= UIFont.Weight.semibold.rawValue ? "Gaegu-Bold" : "Gaegu-Regular"
    }

    /// UIKit appearance(네비바/탭바/지도 마커)용 테마 인식 폰트.
    static func uiFont(size: CGFloat, weight: UIFont.Weight) -> UIFont {
        if isHandDrawn, let font = UIFont(name: crayonUIFontName(for: weight), size: size + crayonFontSizeBump) {
            return font
        }
        return .systemFont(ofSize: size, weight: weight)
    }

    /// 텍스트 스타일의 기본(Large 카테고리) 포인트 크기.
    static func textStyleBaseSize(_ style: Font.TextStyle) -> CGFloat {
        switch style {
        case .largeTitle: return 34
        case .title: return 28
        case .title2: return 22
        case .title3: return 20
        case .headline: return 17
        case .body: return 17
        case .callout: return 16
        case .subheadline: return 15
        case .footnote: return 13
        case .caption: return 12
        case .caption2: return 11
        @unknown default: return 17
        }
    }

    static func textStyleDefaultWeight(_ style: Font.TextStyle) -> Font.Weight {
        style == .headline ? .semibold : .regular
    }

    /// UIKit 렌더링용 색. 오프스크린 렌더러(`UIGraphicsImageRenderer`)는 뷰 계층 밖이라
    /// 동적 색이 앱이 아닌 시스템 외관을 따라간다. 앱이 고른 외관으로 미리 풀어서 넘긴다.
    static func ui(_ color: Color) -> UIColor {
        UIColor(color).resolvedColor(with: FestivalAppearance.trait)
    }

    static var uiCream: UIColor { ui(cream) }
    static var uiCoral: UIColor { ui(coral) }
    static var uiLantern: UIColor { ui(lantern) }
    static var uiTeal: UIColor { ui(teal) }
    static var uiNavy: UIColor { ui(navy) }
    static var uiParkingBlue: UIColor { ui(parkingBlue) }

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

extension Font {
    /// 테마 인식 폰트. 크레파스 테마에서는 손글씨(개구쟁이체), 그 외 테마에서는 기존 시스템 폰트 그대로.
    static func festival(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        if FestivalDesign.isHandDrawn {
            return .custom(FestivalDesign.crayonFontName(for: weight), fixedSize: size + FestivalDesign.crayonFontSizeBump)
        }
        return .system(size: size, weight: weight)
    }

    /// 텍스트 스타일 기반 테마 인식 폰트. 크레파스 테마에서는 Dynamic Type을 따라 스케일된다.
    static func festival(_ style: Font.TextStyle, weight: Font.Weight? = nil) -> Font {
        if FestivalDesign.isHandDrawn {
            let resolvedWeight = weight ?? FestivalDesign.textStyleDefaultWeight(style)
            let size = FestivalDesign.textStyleBaseSize(style) + FestivalDesign.crayonFontSizeBump
            return .custom(FestivalDesign.crayonFontName(for: resolvedWeight), size: size, relativeTo: style)
        }
        let base = Font.system(style)
        if let weight {
            return base.weight(weight)
        }
        return base
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
                .festivalShadow(isSelected ? .medium : .low)
        }
    }

    // 손그림 카드: 거친 차콜 외곽선 + 블러 없는 오프셋 스티커 그림자.
    // 외곽선은 시드가 다른 두 패스를 겹쳐 그려 크레용 왁스 특유의 두 겹 선 느낌을 낸다.
    private func handDrawnBody(_ content: Content) -> some View {
        let strokeColor = isSelected ? FestivalDesign.coral : FestivalDesign.outline
        let shape = RoughRoundedRectangle(cornerRadius: FestivalDesign.cardRadius, roughness: 2.3, seed: 17)
        let wobble = RoughRoundedRectangle(cornerRadius: FestivalDesign.cardRadius, roughness: 3.1, seed: 53)
        return content
            .background(isSelected ? FestivalDesign.tealSoft : FestivalDesign.surface)
            .clipShape(shape)
            .background(
                shape
                    .fill(FestivalDesign.stickerShadowInk)
                    .offset(x: 3, y: 4.5)
            )
            .overlay(
                shape.stroke(strokeColor, lineWidth: isSelected ? 2.6 : 2.2)
            )
            .overlay(
                wobble.stroke(strokeColor.opacity(0.35), lineWidth: isSelected ? 3.4 : 3)
            )
    }
}

extension View {
    func festivalCard(isSelected: Bool = false) -> some View {
        modifier(FestivalCardBackground(isSelected: isSelected))
    }

    /// `FestivalDesign.Elevation` 3단계를 그대로 적용하는 그림자.
    func festivalShadow(_ level: FestivalDesign.Elevation) -> some View {
        let shadow = FestivalDesign.shadow(level)
        return self.shadow(color: shadow.color, radius: shadow.radius, y: shadow.y)
    }

    func festivalNavigationTitle(_ title: String) -> some View {
        self
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text(title)
                        .font(.festival(.headline, weight: .bold))
                        .foregroundStyle(FestivalDesign.coralText)
                }
            }
            .toolbarBackground(FestivalDesign.barSurface, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
    }
}
