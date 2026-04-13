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
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(background)
            .foregroundStyle(foreground)
            .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var background: Color {
        switch kind {
        case .realtime: return .green.opacity(0.16)
        case .warning: return .red.opacity(0.12)
        case .neutral: return .gray.opacity(0.14)
        case .source: return .blue.opacity(0.12)
        }
    }

    private var foreground: Color {
        switch kind {
        case .realtime: return .green
        case .warning: return .red
        case .neutral: return .secondary
        case .source: return .blue
        }
    }
}

struct LoadingStateView: View {
    let text: String

    var body: some View {
        VStack(spacing: 12) {
            ProgressView()
            Text(text)
                .font(.subheadline)
                .foregroundStyle(.secondary)
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
                .font(.headline)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("다시 시도", action: retry)
                .buttonStyle(.borderedProminent)
        }
        .padding()
    }
}
