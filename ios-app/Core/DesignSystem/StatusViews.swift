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
            .clipShape(RoundedRectangle(cornerRadius: 8))
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
        case .realtime: return FestivalDesign.teal
        case .warning: return FestivalDesign.coral
        case .neutral: return FestivalDesign.secondaryText
        case .source: return FestivalDesign.parkingBlue
        }
    }
}

struct LoadingStateView: View {
    let text: String

    var body: some View {
        VStack(spacing: 12) {
            ProgressView()
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
            Text("문제가 발생했습니다")
                .font(.festival(.headline))
            Text(message)
                .font(.festival(.subheadline))
                .foregroundStyle(FestivalDesign.secondaryText)
                .multilineTextAlignment(.center)
            Button("다시 시도", action: retry)
                .buttonStyle(.borderedProminent)
        }
        .padding()
    }
}
