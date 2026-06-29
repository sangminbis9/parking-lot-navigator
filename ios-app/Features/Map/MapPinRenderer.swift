import SwiftUI
import UIKit

/// 지도 핀 카테고리. 렌더러와 카테고리 매퍼가 공유하는 단일 소스.
/// 색상/심볼은 `design/map-pins/_source-category-pin-concepts.png` 컨셉을 따른다.
enum MapPinCategory: String, CaseIterable {
    case defaultFestival
    case music
    case food
    case night
    case market
    case exhibition
    case family
    case tradition
    case sports
    case localEvent
    case parking

    /// 흰 원 안에 들어갈 SF Symbol. (iOS 16.0에서 모두 사용 가능)
    /// 마스코트를 쓰는 카테고리는 마스코트 로드 실패 시 이 심볼로 폴백한다.
    var symbolName: String {
        switch self {
        case .defaultFestival: return "star.fill"
        case .music: return "music.note"
        case .food: return "fork.knife"
        case .night: return "sparkles"
        case .market: return "bag.fill"
        case .exhibition: return "paintpalette.fill"
        case .family: return "figure.2.and.child.holdinghands"
        case .tradition: return "building.columns.fill"
        case .sports: return "figure.run"
        case .localEvent: return "ticket.fill"
        case .parking: return "P"  // 글자 렌더 (심볼 아님)
        }
    }

    /// 흰 원 안에 SF Symbol 대신 마스코트 이미지를 그리는 카테고리.
    var usesMascot: Bool {
        switch self {
        case .defaultFestival, .localEvent: return true
        default: return false
        }
    }

    /// 주차장은 글자("P")를 그린다.
    var usesLetter: Bool { self == .parking }

    /// 카테고리 악센트 색(배지 외곽선·글리프). 일부 카테고리는 테마색을 따른다.
    func fillColor(theme: FestivalTheme) -> UIColor {
        let palette = theme.palette
        switch self {
        case .defaultFestival: return UIColor(palette.coral)
        case .parking: return UIColor(palette.parkingBlue)
        case .music: return UIColor(red: 0.910, green: 0.420, blue: 0.451, alpha: 1)
        case .food: return UIColor(red: 0.953, green: 0.694, blue: 0.357, alpha: 1)
        case .night: return UIColor(red: 0.290, green: 0.310, blue: 0.521, alpha: 1)
        case .market: return UIColor(red: 0.392, green: 0.722, blue: 0.620, alpha: 1)
        case .exhibition: return UIColor(red: 0.643, green: 0.573, blue: 0.898, alpha: 1)
        case .family: return UIColor(red: 0.953, green: 0.620, blue: 0.690, alpha: 1)
        case .tradition: return UIColor(red: 0.333, green: 0.702, blue: 0.682, alpha: 1)
        case .sports: return UIColor(red: 0.451, green: 0.675, blue: 0.859, alpha: 1)
        case .localEvent: return UIColor(red: 0.949, green: 0.761, blue: 0.333, alpha: 1)
        }
    }

}

// MARK: - 카테고리 매퍼 (순수 함수, 테스트 대상)

extension MapPinCategory {
    /// 명시적 카테고리 → 태그 → 제목/설명 키워드 순으로 판별한다.
    /// 어떤 단서로도 분류되지 않으면 `.defaultFestival`.
    static func resolve(
        primaryCategory: FestivalPrimaryCategory?,
        categoryTags: [String],
        title: String,
        description: String?,
        rawTags: [String]
    ) -> MapPinCategory {
        if let primaryCategory, let mapped = map(primaryCategory) {
            return mapped
        }
        // 태그 우선 (단, #축제 같은 일반 태그만으로는 결정하지 않음 → keyword 목록에 없음)
        let tagText = (categoryTags + rawTags).joined(separator: " ")
        if let fromTags = keyword(in: tagText) {
            return fromTags
        }
        if let fromText = keyword(in: title + " " + (description ?? "")) {
            return fromText
        }
        return .defaultFestival
    }

    static func forFestival(_ festival: Festival) -> MapPinCategory {
        resolve(
            primaryCategory: festival.primaryCategory,
            categoryTags: festival.categoryTags ?? [],
            title: festival.title,
            description: festival.description ?? festival.subtitle,
            rawTags: festival.tags
        )
    }

    /// 로컬 매장 이벤트는 단일 "지역·로컬행사" 카테고리로 표시한다.
    static func forEvent(_ event: FreeEvent) -> MapPinCategory {
        .localEvent
    }

    private static func map(_ category: FestivalPrimaryCategory) -> MapPinCategory? {
        switch category {
        case .musicPerformance: return .music
        case .foodDrink: return .food
        case .lightNight: return .night
        case .marketFlea: return .market
        case .artExhibition, .filmMedia: return .exhibition
        case .familyKids: return .family
        case .traditionCulture: return .tradition
        case .sportsOutdoor: return .sports
        case .natureFlower, .etc: return nil  // 전용 카테고리 없음 → keyword/기본 핀으로
        }
    }

    private static func keyword(in text: String) -> MapPinCategory? {
        let lower = text.lowercased()
        func has(_ words: [String]) -> Bool { words.contains { lower.contains($0) } }

        if has(["콘서트", "음악", "공연", "페스티벌", "버스킹", "concert", "music"]) { return .music }
        if has(["푸드", "음식", "먹거리", "미식", "맛집", "food"]) { return .food }
        if has(["불꽃", "야간", "라이트", "야경", "firework"]) { return .night }
        if has(["마켓", "장터", "플리마켓", "마르쉐", "market"]) { return .market }
        if has(["전시", "미술", "아트", "박람회", "갤러리", "art"]) { return .exhibition }
        if has(["어린이", "가족", "키즈", "아이", "kids", "family"]) { return .family }
        if has(["전통", "문화재", "민속", "한복"]) { return .tradition }
        if has(["스포츠", "마라톤", "걷기", "야외", "러닝", "트레킹", "sports"]) { return .sports }
        return nil
    }
}

// MARK: - 렌더러

/// 카테고리/테마/선택여부/scale 조합으로 깨끗한 핀 이미지를 생성하고 캐시한다.
/// PNG를 crop하지 않고 UIGraphicsImageRenderer로 직접 그린다.
enum MapPinRenderer {
    // KakaoMaps SDK는 UIImage 픽셀 크기를 pt로 취급하므로, 논리 크기에 0.5를 곱해 비트맵을 만든다.
    static let scale: CGFloat = 0.5
    static let baseDiameter: CGFloat = 42        // 둥근 사각 배지 한 변
    static let shadowPadding: CGFloat = 5
    static let selectedScaleFactor: CGFloat = 1.2
    static let cornerRatio: CGFloat = 0.30       // 배지 모서리 둥글기(앱 카드 언어)
    static let floatGapRatio: CGFloat = 0.06     // 배지와 지면 그림자 사이 간격
    static let groundShadowRatio: CGFloat = 0.16 // 지면 그림자 타원 높이

    /// 선택된(1.2배) 핀의 "지면 그림자(tip) → 스파크 포함 상단" 거리(논리 pt). 홀로그램 커넥터 앵커 계산에 쓴다.
    /// 홀로그램은 선택 핀에만 표시되므로 커넥터가 확대된 핀 전체를 비켜가도록 이 값을 쓴다.
    static var selectedTipToTop: CGFloat {
        let d = baseDiameter * selectedScaleFactor
        return d * 0.42 + d + d * floatGapRatio + d * groundShadowRatio
    }

    private struct Key: Hashable {
        let category: MapPinCategory
        let themeID: String
        let selected: Bool
        let scaleKey: Int
    }

    private static var cache: [Key: UIImage] = [:]

    /// 캐시되는 기본 핀 이미지. 키: (category, theme, isSelected, scale).
    static func image(
        category: MapPinCategory,
        theme: FestivalTheme,
        selected: Bool,
        scale: CGFloat = MapPinRenderer.scale
    ) -> UIImage {
        let key = Key(category: category, themeID: theme.rawValue, selected: selected, scaleKey: Int((scale * 100).rounded()))
        if let cached = cache[key] { return cached }
        let image = draw(category: category, theme: theme, selected: selected, label: nil, scale: scale)
        cache[key] = image
        return image
    }

    /// 제목 라벨 버블이 달린 핀. (라벨 종류가 많아 별도 캐시하지 않고 호출부에서 styleID 단위로 1회 등록)
    static func labeledImage(
        category: MapPinCategory,
        theme: FestivalTheme,
        label: String,
        scale: CGFloat = MapPinRenderer.scale
    ) -> UIImage {
        draw(category: category, theme: theme, selected: false, label: label, scale: scale)
    }

    private static var parkingCache: [String: UIImage] = [:]

    /// 실시간 주차장용: 혼잡도 색(fill)으로 채운 "P" 주차 핀. 색은 테마와 무관하므로 색+scale로만 캐시한다.
    static func parkingImage(fill: UIColor, theme: FestivalTheme, scale: CGFloat = MapPinRenderer.scale) -> UIImage {
        let key = "\(fill.pinColorKey)|\(Int((scale * 100).rounded()))"
        if let cached = parkingCache[key] { return cached }
        let image = draw(category: .parking, theme: theme, selected: false, label: nil, scale: scale, fillOverride: fill)
        parkingCache[key] = image
        return image
    }

    /// 클러스터 핀(개수 뱃지). 카테고리와 무관하게 tint로 그린다.
    /// 클러스터는 개별 핀(물방울)과 달리 단순 원형 버블로 그린다.
    /// 개수 구간(2~9 / 10~49 / 50+)에 따라 크기와 색 진하기를 단계화한다 — 카카오·네이버·구글 표준.
    /// `isParking`/`theme`는 색(tint)에 이미 반영되어 있어 형태에는 쓰지 않는다.
    static func clusterImage(tint: UIColor, count: Int, isParking: Bool, theme: FestivalTheme, scale: CGFloat = MapPinRenderer.scale) -> UIImage {
        let tier = count < 10 ? 0 : (count < 50 ? 1 : 2)
        let innerD: CGFloat = [30, 38, 46][tier]
        let fill: UIColor = [tint.pinMixedWithWhite(0.30), tint, tint.pinDeepened(0.72)][tier]
        let haloD = innerD + 12
        let canvas = haloD + shadowPadding * 2
        let center = canvas / 2

        let renderer = UIGraphicsImageRenderer(size: CGSize(width: canvas * scale, height: canvas * scale))
        return renderer.image { ctx in
            ctx.cgContext.scaleBy(x: scale, y: scale)

            // 반투명 외곽 헤일로 — 클러스터를 영역 요약으로 보이게 한다.
            fill.withAlphaComponent(0.22).setFill()
            UIBezierPath(ovalIn: CGRect(x: center - haloD / 2, y: center - haloD / 2, width: haloD, height: haloD)).fill()

            // 내부 컬러 원 + 그림자
            let innerRect = CGRect(x: center - innerD / 2, y: center - innerD / 2, width: innerD, height: innerD)
            ctx.cgContext.saveGState()
            ctx.cgContext.setShadow(offset: CGSize(width: 0, height: 1), blur: 3, color: FestivalDesign.uiNavy.withAlphaComponent(0.28).cgColor)
            fill.setFill()
            UIBezierPath(ovalIn: innerRect).fill()
            ctx.cgContext.restoreGState()

            UIColor.white.setStroke()
            let ring = UIBezierPath(ovalIn: innerRect)
            ring.lineWidth = 1.5
            ring.stroke()

            let badgeText = count > 99 ? "99+" : "\(count)"
            let paragraph = NSMutableParagraphStyle()
            paragraph.alignment = .center
            let attributes: [NSAttributedString.Key: Any] = [
                .font: FestivalDesign.uiFont(size: innerD * (count > 99 ? 0.34 : 0.42), weight: .heavy),
                .foregroundColor: UIColor.white,
                .paragraphStyle: paragraph
            ]
            let textSize = (badgeText as NSString).size(withAttributes: attributes)
            (badgeText as NSString).draw(
                in: CGRect(x: innerRect.midX - textSize.width / 2, y: innerRect.midY - textSize.height / 2, width: textSize.width, height: textSize.height),
                withAttributes: attributes
            )
        }
    }

    // MARK: 코어 드로잉

    private static func draw(
        category: MapPinCategory,
        theme: FestivalTheme,
        selected: Bool,
        label: String?,
        scale: CGFloat,
        fillOverride: UIColor? = nil
    ) -> UIImage {
        let handDrawn = theme.isHandDrawn
        let badge = baseDiameter * (selected ? selectedScaleFactor : 1)
        let corner = badge * cornerRatio
        let accent = fillOverride ?? category.fillColor(theme: theme)
        let glyphColor = accent.pinDeepened(0.62)
        let surface = UIColor(theme.palette.surface)

        // 라벨 버블 측정
        let labelFont = FestivalDesign.uiFont(size: 14, weight: .semibold)
        var bubbleWidth: CGFloat = 0
        let bubbleHeight: CGFloat = 24
        let labelGap: CGFloat = 4
        if let label, !label.isEmpty {
            let textWidth = (label as NSString).size(withAttributes: [.font: labelFont]).width
            bubbleWidth = min(ceil(textWidth + 18), 128)
        }
        let labelZone = bubbleWidth > 0 ? bubbleHeight + labelGap : 0
        let sparkleZone = selected ? badge * 0.42 : 0

        let floatGap = badge * floatGapRatio
        let groundW = badge * 0.66
        let groundH = badge * groundShadowRatio

        // 손그림 테마는 오프셋 스티커 그림자 때문에 우/하단 여유가 더 필요하다.
        let stickerInset: CGFloat = handDrawn ? 4 : 0
        let pinCanvasW = badge + shadowPadding * 2 + stickerInset
        let canvasW = max(pinCanvasW, bubbleWidth + shadowPadding * 2)
        let badgeTop = shadowPadding + sparkleZone + labelZone
        let canvasH = badgeTop + badge + floatGap + groundH
        let cx = canvasW / 2

        let renderer = UIGraphicsImageRenderer(size: CGSize(width: canvasW * scale, height: canvasH * scale))
        return renderer.image { ctx in
            ctx.cgContext.scaleBy(x: scale, y: scale)

            if bubbleWidth > 0, let label {
                drawLabelBubble(label, font: labelFont, fill: accent, centerX: cx, top: shadowPadding + sparkleZone, width: bubbleWidth, height: bubbleHeight, context: ctx)
            }

            let badgeRect = CGRect(x: cx - badge / 2, y: badgeTop, width: badge, height: badge)

            // 지면 그림자 타원 — teardrop 꼬리 대신 위치를 가리키고 "지면에 선" 느낌을 준다.
            let groundRect = CGRect(x: cx - groundW / 2, y: canvasH - groundH, width: groundW, height: groundH)
            FestivalDesign.uiNavy.withAlphaComponent(0.16).setFill()
            UIBezierPath(ovalIn: groundRect).fill()

            if selected {
                drawSparkles(aboveTopOf: badgeRect, context: ctx)
            }

            drawStickerBadge(
                rect: badgeRect, corner: corner, accent: accent, surface: surface,
                handDrawn: handDrawn, selected: selected, context: ctx
            )

            // 카테고리 글리프 (현행 유지)
            let inner = badgeRect.insetBy(dx: badge * 0.20, dy: badge * 0.20)
            drawGlyph(category: category, glyphColor: glyphColor, in: inner, diameter: badge, context: ctx)
        }
    }

    /// 앱 카드 언어의 둥근 사각 "스티커 배지" 본체.
    /// 기본 테마: surface 배경 + 카테고리색 외곽선 + soft 그림자.
    /// 크레파스 테마: 차콜 외곽선 + 블러 없는 오프셋 스티커 그림자(카드와 동일).
    private static func drawStickerBadge(
        rect: CGRect,
        corner: CGFloat,
        accent: UIColor,
        surface: UIColor,
        handDrawn: Bool,
        selected: Bool,
        context: UIGraphicsImageRendererContext
    ) {
        let cg = context.cgContext
        let body = UIBezierPath(roundedRect: rect, cornerRadius: corner)

        if handDrawn {
            let outline = UIColor(FestivalDesign.outline)
            let shadow = UIBezierPath(roundedRect: rect.offsetBy(dx: 2.5, dy: 3.5), cornerRadius: corner)
            outline.withAlphaComponent(0.85).setFill()
            shadow.fill()
            surface.setFill()
            body.fill()
            (selected ? FestivalDesign.uiCoral : outline).setStroke()
            body.lineWidth = selected ? 2.8 : 2.4
            body.stroke()
        } else {
            cg.saveGState()
            cg.setShadow(
                offset: CGSize(width: 0, height: 2.5),
                blur: 5,
                color: FestivalDesign.uiNavy.withAlphaComponent(0.18).cgColor
            )
            surface.setFill()
            body.fill()
            cg.restoreGState()
            (selected ? FestivalDesign.uiCoral : accent).setStroke()
            body.lineWidth = selected ? 2.8 : 2.2
            body.stroke()
        }
    }

    private static func drawGlyph(
        category: MapPinCategory,
        glyphColor: UIColor,
        in inner: CGRect,
        diameter: CGFloat,
        context: UIGraphicsImageRendererContext
    ) {
        if category.usesMascot, let mascot = UIImage(named: "FestivalMascotIcon") {
            let box = inner.insetBy(dx: inner.width * 0.08, dy: inner.height * 0.08)
            let fitted = aspectFit(imageSize: mascot.size, in: box)
            mascot.draw(in: fitted)
            return
        }
        if category.usesLetter {
            let paragraph = NSMutableParagraphStyle()
            paragraph.alignment = .center
            let attributes: [NSAttributedString.Key: Any] = [
                .font: FestivalDesign.uiFont(size: diameter * 0.42, weight: .heavy),
                .foregroundColor: glyphColor,
                .paragraphStyle: paragraph
            ]
            let text = "P" as NSString
            let size = text.size(withAttributes: attributes)
            text.draw(in: CGRect(x: inner.midX - size.width / 2, y: inner.midY - size.height / 2, width: size.width, height: size.height), withAttributes: attributes)
            return
        }
        let symbolName = category.symbolName
        let image = UIImage(systemName: symbolName) ?? UIImage(systemName: "star.fill")
        if let image {
            let iconSize = diameter * 0.40
            let rect = CGRect(x: inner.midX - iconSize / 2, y: inner.midY - iconSize / 2, width: iconSize, height: iconSize)
            image.withTintColor(glyphColor, renderingMode: .alwaysOriginal).draw(in: rect)
        }
    }

    private static func drawLabelBubble(
        _ label: String,
        font: UIFont,
        fill: UIColor,
        centerX: CGFloat,
        top: CGFloat,
        width: CGFloat,
        height: CGFloat,
        context: UIGraphicsImageRendererContext
    ) {
        let rect = CGRect(x: centerX - width / 2, y: top, width: width, height: height)
        let bubble = UIBezierPath(roundedRect: rect, cornerRadius: 11)
        context.cgContext.saveGState()
        context.cgContext.setShadow(offset: CGSize(width: 0, height: 1.5), blur: 4, color: FestivalDesign.uiNavy.withAlphaComponent(0.18).cgColor)
        FestivalDesign.uiCream.setFill()
        bubble.fill()
        context.cgContext.restoreGState()
        fill.withAlphaComponent(0.6).setStroke()
        bubble.lineWidth = 1.1
        bubble.stroke()

        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        paragraph.lineBreakMode = .byTruncatingTail
        let attributes: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: FestivalDesign.uiNavy,
            .paragraphStyle: paragraph
        ]
        (label as NSString).draw(in: rect.insetBy(dx: 9, dy: 3), withAttributes: attributes)
    }

    private static func drawSparkles(
        aboveTopOf headRect: CGRect,
        context: UIGraphicsImageRendererContext
    ) {
        let cx = headRect.midX
        let topY = headRect.minY
        FestivalDesign.uiCoral.setStroke()
        // 원 상단 위로 부채꼴로 퍼지는 4개의 짧은 방사형 선 (무한 애니메이션 없음 — 정적 이미지)
        let angles: [CGFloat] = [1.30, 1.42, 1.58, 1.70].map { $0 * .pi }
        let inner = headRect.width * 0.08
        let outer = headRect.width * 0.26
        for angle in angles {
            let path = UIBezierPath()
            path.move(to: CGPoint(x: cx + cos(angle) * inner, y: topY + sin(angle) * inner))
            path.addLine(to: CGPoint(x: cx + cos(angle) * outer, y: topY + sin(angle) * outer))
            path.lineWidth = max(1.4, headRect.width * 0.045)
            path.lineCapStyle = .round
            path.stroke()
        }
        // 중앙 위 작은 반짝임
        UIColor(red: 1.0, green: 0.83, blue: 0.25, alpha: 1).setFill()
        let dot = headRect.width * 0.06
        UIBezierPath(ovalIn: CGRect(x: cx - dot / 2, y: topY - outer - dot, width: dot, height: dot)).fill()
    }

    private static func aspectFit(imageSize: CGSize, in rect: CGRect) -> CGRect {
        guard imageSize.width > 0, imageSize.height > 0 else { return rect }
        let scale = min(rect.width / imageSize.width, rect.height / imageSize.height)
        let w = imageSize.width * scale
        let h = imageSize.height * scale
        return CGRect(x: rect.midX - w / 2, y: rect.midY - h / 2, width: w, height: h)
    }
}

private extension UIColor {
    /// 캐시 키용 RGBA 문자열.
    var pinColorKey: String {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        getRed(&r, green: &g, blue: &b, alpha: &a)
        return [r, g, b, a].map { String(Int(($0 * 255).rounded())) }.joined(separator: "-")
    }

    /// 흰색과 혼합해 더 옅게 만든다. t=0 원색, t=1 흰색.
    func pinMixedWithWhite(_ t: CGFloat) -> UIColor {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        getRed(&r, green: &g, blue: &b, alpha: &a)
        return UIColor(red: r + (1 - r) * t, green: g + (1 - g) * t, blue: b + (1 - b) * t, alpha: a)
    }

    /// 채움색을 진하게 눌러 흰 배경 위 대비를 확보한다. factor<1 → 더 어둡게.
    func pinDeepened(_ factor: CGFloat) -> UIColor {
        var hue: CGFloat = 0, sat: CGFloat = 0, bri: CGFloat = 0, alpha: CGFloat = 0
        if getHue(&hue, saturation: &sat, brightness: &bri, alpha: &alpha) {
            return UIColor(hue: hue, saturation: min(sat * 1.12, 1), brightness: bri * factor, alpha: alpha)
        }
        var white: CGFloat = 0
        if getWhite(&white, alpha: &alpha) {
            return UIColor(white: white * factor, alpha: alpha)
        }
        return self
    }
}
