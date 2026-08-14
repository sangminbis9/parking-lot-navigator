import SwiftUI

/// 화면 상단에 잠깐 떴다 사라지는 작은 알림. 복사처럼 즉시 끝나는 동작의 피드백용.
@MainActor
final class ToastCenter: ObservableObject {
    @Published private(set) var message: String?
    private var dismissTask: Task<Void, Never>?

    func show(_ message: String) {
        dismissTask?.cancel()
        withAnimation(.easeOut(duration: FestivalDesign.Motion.standard)) {
            self.message = message
        }
        dismissTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 1_600_000_000)
            guard !Task.isCancelled else { return }
            withAnimation(.easeIn(duration: FestivalDesign.Motion.standard)) {
                self?.message = nil
            }
        }
    }
}

/// 루트 뷰 상단에 얹는 토스트. 탭을 가로채지 않도록 hit test는 끈다.
struct FestivalToastOverlay: View {
    @EnvironmentObject private var toastCenter: ToastCenter

    var body: some View {
        if let message = toastCenter.message {
            HStack(spacing: 8) {
                Image("FestivalMascotIcon")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 22, height: 22)
                    .accessibilityHidden(true)
                Text(message)
                    .font(.festival(.caption, weight: .semibold))
                    .foregroundStyle(FestivalDesign.navy)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(Capsule().fill(FestivalDesign.surface))
            .overlay(Capsule().stroke(FestivalDesign.creamDeep.opacity(0.5), lineWidth: 1))
            .festivalShadow(.high)
            .padding(.top, 6)
            .transition(.move(edge: .top).combined(with: .opacity))
            .allowsHitTesting(false)
        }
    }
}
