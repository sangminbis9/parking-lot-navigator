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

    /// 핀 실루엣(물방울) 채움색. 일부 카테고리는 테마색을 따른다.
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

    /// 흰 배경 위 심볼/글자색. 채움색을 진하게 눌러 대비를 확보한다.
    func symbolColor(theme: FestivalTheme) -> UIColor {
        fillColor(theme: theme).pinDeepened(0.62)
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
    static let baseDiameter: CGFloat = 42
    static let tailRatio: CGFloat = 0.40
    static let shadowPadding: CGFloat = 5
    static let selectedScaleFactor: CGFloat = 1.2

    /// 선택된(1.2배) 핀의 "tip → 스파크 포함 상단" 거리(논리 pt). 홀로그램 커넥터 앵커 계산에 쓴다.
    /// 홀로그램은 선택 핀에만 표시되므로 커넥터가 확대된 핀 전체를 비켜가도록 이 값을 쓴다.
    static var selectedTipToTop: CGFloat {
        let d = baseDiameter * selectedScaleFactor
        return d * 0.42 + d + d * tailRatio
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

    /// 클러스터 핀(개수 뱃지). 카테고리와 무관하게 tint로 그린다.
    static func clusterImage(tint: UIColor, count: Int, isParking: Bool, theme: FestivalTheme, scale: CGFloat = MapPinRenderer.scale) -> UIImage {
        let diameter = baseDiameter
        let r = diameter / 2
        let tail = diameter * tailRatio
        let badgeSize = diameter * 0.5
        let canvasW = diameter + shadowPadding * 2 + badgeSize * 0.35
        let circleTop = shadowPadding + badgeSize * 0.28
        let canvasH = circleTop + diameter + tail
        let cx = (diameter + shadowPadding * 2) / 2

        let renderer = UIGraphicsImageRenderer(size: CGSize(width: canvasW * scale, height: canvasH * scale))
        return renderer.image { ctx in
            ctx.cgContext.scaleBy(x: scale, y: scale)
            let headRect = CGRect(x: cx - r, y: circleTop, width: diameter, height: diameter)
            drawSilhouette(headRect: headRect, tail: tail, fill: tint, context: ctx)

            let inner = headRect.insetBy(dx: diameter * 0.16, dy: diameter * 0.16)
            UIColor.white.setFill()
            UIBezierPath(ovalIn: inner).fill()

            let badgeText = count > 99 ? "99+" : "\(count)"
            let paragraph = NSMutableParagraphStyle()
            paragraph.alignment = .center
            let attributes: [NSAttributedString.Key: Any] = [
                .font: FestivalDesign.uiFont(size: diameter * (count > 99 ? 0.30 : 0.38), weight: .heavy),
                .foregroundColor: tint.pinDeepened(0.6),
                .paragraphStyle: paragraph
            ]
            let textSize = (badgeText as NSString).size(withAttributes: attributes)
            (badgeText as NSString).draw(
                in: CGRect(x: inner.midX - textSize.width / 2, y: inner.midY - textSize.height / 2, width: textSize.width, height: textSize.height),
                withAttributes: attributes
            )

            // 종류 구분용 작은 뱃지
            let badgeRect = CGRect(x: headRect.maxX - badgeSize * 0.7, y: headRect.minY - badgeSize * 0.18, width: badgeSize, height: badgeSize)
            ctx.cgContext.saveGState()
            ctx.cgContext.setShadow(offset: CGSize(width: 0, height: 1), blur: 2, color: FestivalDesign.uiNavy.withAlphaComponent(0.2).cgColor)
            (isParking ? UIColor(theme.palette.parkingBlue) : FestivalDesign.uiCoral).setFill()
            UIBezierPath(ovalIn: badgeRect).fill()
            ctx.cgContext.restoreGState()
            UIColor.white.setStroke()
            let badgeOutline = UIBezierPath(ovalIn: badgeRect)
            badgeOutline.lineWidth = 1
            badgeOutline.stroke()
            if let glyph = UIImage(systemName: isParking ? "parkingsign.circle.fill" : "sparkles") {
                glyph.withTintColor(.white, renderingMode: .alwaysOriginal)
                    .draw(in: badgeRect.insetBy(dx: badgeSize * 0.22, dy: badgeSize * 0.22))
            }
        }
    }

    // MARK: 코어 드로잉

    private static func draw(
        category: MapPinCategory,
        theme: FestivalTheme,
        selected: Bool,
        label: String?,
        scale: CGFloat
    ) -> UIImage {
        let diameter = baseDiameter * (selected ? selectedScaleFactor : 1)
        let r = diameter / 2
        let tail = diameter * tailRatio
        let fill = category.fillColor(theme: theme)

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
        let sparkleZone = selected ? diameter * 0.42 : 0

        let pinCanvasW = diameter + shadowPadding * 2
        let canvasW = max(pinCanvasW, bubbleWidth + shadowPadding * 2)
        let circleTop = shadowPadding + sparkleZone + labelZone
        let canvasH = circleTop + diameter + tail
        let cx = canvasW / 2

        let renderer = UIGraphicsImageRenderer(size: CGSize(width: canvasW * scale, height: canvasH * scale))
        return renderer.image { ctx in
            ctx.cgContext.scaleBy(x: scale, y: scale)

            if bubbleWidth > 0, let label {
                drawLabelBubble(label, font: labelFont, fill: fill, centerX: cx, top: shadowPadding + sparkleZone, width: bubbleWidth, height: bubbleHeight, context: ctx)
            }

            let headRect = CGRect(x: cx - r, y: circleTop, width: diameter, height: diameter)

            if selected {
                drawSparkles(aboveTopOf: headRect, context: ctx)
            }

            drawSilhouette(headRect: headRect, tail: tail, fill: fill, context: ctx)

            // 선택 강조 링
            if selected {
                FestivalDesign.uiCoral.setStroke()
                let ring = UIBezierPath(ovalIn: headRect.insetBy(dx: -1.6, dy: -1.6))
                ring.lineWidth = 2.4
                ring.stroke()
            }

            // 흰 원 + 심볼/마스코트/글자
            let inner = headRect.insetBy(dx: diameter * 0.15, dy: diameter * 0.15)
            UIColor.white.setFill()
            UIBezierPath(ovalIn: inner).fill()
            drawGlyph(category: category, theme: theme, in: inner, diameter: diameter, context: ctx)
        }
    }

    private static func drawSilhouette(
        headRect: CGRect,
        tail: CGFloat,
        fill: UIColor,
        context: UIGraphicsImageRendererContext
    ) {
        let diameter = headRect.width
        let cx = headRect.midX
        let tipY = headRect.maxY + tail
        let tailHalf = max(diameter * 0.16, 4)
        let tailBaseY = headRect.maxY - diameter * 0.06

        let tailPath = UIBezierPath()
        tailPath.move(to: CGPoint(x: cx - tailHalf, y: tailBaseY))
        tailPath.addLine(to: CGPoint(x: cx + tailHalf, y: tailBaseY))
        tailPath.addLine(to: CGPoint(x: cx, y: tipY))
        tailPath.close()

        let head = UIBezierPath(ovalIn: headRect)

        context.cgContext.saveGState()
        context.cgContext.setShadow(
            offset: CGSize(width: 0, height: 1.2),
            blur: 3,
            color: FestivalDesign.uiNavy.withAlphaComponent(0.20).cgColor
        )
        fill.setFill()
        tailPath.fill()
        head.fill()
        context.cgContext.restoreGState()

        // 얇은 테두리: 진한 채움색. 외곽선이 잘리지 않게 silhouette 안쪽으로 stroke.
        let border = fill.pinDeepened(0.78)
        border.setStroke()
        head.lineWidth = 1.2
        head.stroke()
        let tailEdge = UIBezierPath()
        tailEdge.move(to: CGPoint(x: cx - tailHalf, y: tailBaseY))
        tailEdge.addLine(to: CGPoint(x: cx, y: tipY))
        tailEdge.addLine(to: CGPoint(x: cx + tailHalf, y: tailBaseY))
        tailEdge.lineWidth = 1.2
        tailEdge.lineJoinStyle = .round
        tailEdge.stroke()
    }

    private static func drawGlyph(
        category: MapPinCategory,
        theme: FestivalTheme,
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
                .foregroundColor: category.symbolColor(theme: theme),
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
            image.withTintColor(category.symbolColor(theme: theme), renderingMode: .alwaysOriginal).draw(in: rect)
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
