import SwiftUI

struct StatusBadge: View {
    let text: String
    let kind: Kind

    enum Kind {
        case realtime
        case warning
        case neutral
        case source
        case sponsor
        /// 종류 배지처럼 분류 색을 그대로 따라가야 하는 경우.
        case tinted(Color)
    }

    var body: some View {
        Text(text)
            .font(.festival(.caption, weight: .semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(background)
            .foregroundStyle(foreground)
            .clipShape(FestivalDesign.chipShape)
    }

    private var background: Color {
        switch kind {
        case .realtime: return FestivalDesign.teal.opacity(0.16)
        case .warning: return FestivalDesign.coral.opacity(0.14)
        case .neutral: return FestivalDesign.cream.opacity(0.45)
        case .source: return FestivalDesign.parkingSoft
        case .sponsor: return FestivalDesign.lantern.opacity(0.18)
        case .tinted(let color): return color.opacity(0.16)
        }
    }

    private var foreground: Color {
        switch kind {
        case .realtime: return FestivalDesign.tealText
        case .warning: return FestivalDesign.coralText
        case .neutral: return FestivalDesign.secondaryText
        case .source: return FestivalDesign.parkingBlueText
        case .sponsor: return FestivalDesign.lanternText
        case .tinted(let color): return FestivalDesign.readable(color)
        }
    }
}

extension DiscoverDomain {
    /// 이벤트 탭 종류 토글과 지도 레이어가 쓰는 색. 카드의 종류 태그도 같은 색을 따라간다.
    var tint: Color {
        switch self {
        case .festival: return FestivalDesign.coral
        case .performance: return FestivalPrimaryCategory.musicPerformance.tint
        case .tradeExpo: return FestivalPrimaryCategory.tradeExpo.tint
        case .localEvent: return FestivalDesign.teal
        }
    }
}

extension DiscoverStatus {
    /// 진행 상태 색은 화면마다 카테고리 tint를 따라가서 예정이 빨강·보라·회색으로 제각각이었다.
    /// 상태 색은 여기 한 곳에서만 정한다. 진행 중은 코랄, 예정은 중립 회색.
    var badgeKind: StatusBadge.Kind { self == .ongoing ? .warning : .neutral }
    var chipFill: Color { self == .ongoing ? FestivalDesign.coral.opacity(0.14) : FestivalDesign.cream.opacity(0.45) }
    var chipText: Color { self == .ongoing ? FestivalDesign.coralText : FestivalDesign.secondaryText }
}

struct LoadingStateView: View {
    let text: String

    var body: some View {
        VStack(spacing: 12) {
            ProgressView()
                .tint(FestivalDesign.teal)
            Text(text)
                .font(.festival(.subheadline))
                .foregroundStyle(FestivalDesign.secondaryText)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct FailureStateView: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Text(message)
                .font(.festival(.subheadline))
                .foregroundStyle(FestivalDesign.navy)
                .multilineTextAlignment(.center)
            Button("다시 시도", action: retry)
                .buttonStyle(.borderedProminent)
                .tint(FestivalDesign.teal)
        }
        .padding()
    }
}
