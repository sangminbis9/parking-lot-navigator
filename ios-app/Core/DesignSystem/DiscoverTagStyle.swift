import SwiftUI

/// 태그(칩) 색 규칙을 한곳에 모은 곳. 지도 홀로그램 카드에서 쓰던 규칙을 앱 전체 기준으로 삼는다.
///
/// - 배경색은 언제나 그 행사의 분류 토글 색(`DiscoverDomain.tint`)이다.
/// - 줄의 맨 앞 태그만 그 색을 꽉 채우고, 뒤따르는 태그는 같은 색을 옅게 깐다.
///
/// 색·농도·글자 크기를 바꿀 일이 생기면 이 파일만 고치면 태그가 나오는 모든 화면에 같이 반영된다.
enum DiscoverTagStyle {
    /// 뒤따르는 태그 배경 농도.
    static let softOpacity: Double = 0.12

    static func fill(_ tint: Color, isLead: Bool) -> Color {
        isLead ? tint : tint.opacity(softOpacity)
    }

    static func text(_ tint: Color, isLead: Bool) -> Color {
        isLead ? FestivalDesign.onFill(tint) : FestivalDesign.readable(tint)
    }

    enum Size {
        /// 지도 홀로그램 카드·캘린더 목록처럼 줄이 좁은 곳.
        case compact
        /// 이벤트 목록·즐겨찾기·상세 화면.
        case regular

        func font(isLead: Bool) -> Font {
            switch self {
            case .compact: return .festival(size: 10, weight: isLead ? .bold : .medium)
            case .regular: return .festival(.caption, weight: isLead ? .bold : .medium)
            }
        }

        var horizontalPadding: CGFloat { self == .compact ? 6 : 8 }
        var verticalPadding: CGFloat { self == .compact ? 2 : 4 }
        var spacing: CGFloat { self == .compact ? 5 : 6 }
    }
}

/// 규칙 하나를 그대로 따르는 태그 한 개.
struct DiscoverTagChip: View {
    let text: String
    let tint: Color
    var isLead: Bool = false
    var size: DiscoverTagStyle.Size = .regular

    var body: some View {
        Text(text)
            .font(size.font(isLead: isLead))
            .foregroundStyle(DiscoverTagStyle.text(tint, isLead: isLead))
            .padding(.horizontal, size.horizontalPadding)
            .padding(.vertical, size.verticalPadding)
            .background(FestivalDesign.chipShape.fill(DiscoverTagStyle.fill(tint, isLead: isLead)))
            .lineLimit(1)
    }
}

/// 태그 여러 개를 한 줄 규칙(맨 앞만 꽉 참)으로 흘려 놓는다.
struct DiscoverTagRow: View {
    let tags: [String]
    let tint: Color
    /// 맨 앞 태그를 이 줄에서 채울지. 앞 태그를 다른 뷰가 이미 채운 줄이면 false.
    var leadsRow: Bool = true
    var size: DiscoverTagStyle.Size = .regular

    var body: some View {
        RegionFlowLayout(spacing: size.spacing) {
            ForEach(Array(tags.enumerated()), id: \.offset) { index, tag in
                DiscoverTagChip(
                    text: tag,
                    tint: tint,
                    isLead: leadsRow && index == 0,
                    size: size
                )
            }
        }
    }
}
