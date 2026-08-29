import SwiftUI

struct StatusBadge: View {
    let text: String
    let kind: Kind

    enum Kind {
        case realtime
        case warning
        case neutral
        case source
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
        }
    }

    private var foreground: Color {
        switch kind {
        case .realtime: return FestivalDesign.tealText
        case .warning: return FestivalDesign.coralText
        case .neutral: return FestivalDesign.secondaryText
        case .source: return FestivalDesign.parkingBlueText
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
    /// 앱 화면의 상태 태그는 이제 분류 토글 색을 따라간다(`DiscoverTagStyle`).
    /// 여기 남은 색은 그 규칙을 쓸 수 없는 위젯·지도 목록의 글자색용이다.
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
                .accessibilityIdentifier("failure-message")
            Button("다시 시도", action: retry)
                .buttonStyle(.borderedProminent)
                .tint(FestivalDesign.teal)
                .accessibilityIdentifier("failure-retry")
        }
        .padding()
    }
}
