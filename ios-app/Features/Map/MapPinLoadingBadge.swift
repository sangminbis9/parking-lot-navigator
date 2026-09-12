import SwiftUI

/// GIF 파일/디코딩 없이 마스코트 앞의 링만 애니메이션한다.
/// 네트워크 응답 → SDK 핀 렌더 사이의 짧은 공백에도 깜빡이지 않는다.
struct MapPinLoadingBadge: View {
    let isLoading: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isVisible = false

    var body: some View {
        ZStack(alignment: .topTrailing) {
            if isVisible {
                VStack(spacing: 0) {
                    ZStack(alignment: .bottom) {
                        Image("FestivalMascotGuide")
                            .resizable()
                            .scaledToFit()
                            .frame(width: 76, height: 76)
                            .accessibilityHidden(true)

                        // 마스코트보다 뒤에 선언해 몸 앞쪽 레이어에 올린다.
                        loadingRing
                            .frame(width: 28, height: 28)
                            .padding(5)
                            .background(FestivalDesign.surface.opacity(0.96), in: Circle())
                            .offset(y: 3)
                            .accessibilityHidden(true)
                    }
                    Text("핀 불러오는 중")
                        .font(.festival(.caption2, weight: .semibold))
                        .foregroundStyle(FestivalDesign.navy)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 4)
                        .background(FestivalDesign.surface.opacity(0.96), in: Capsule())
                        .padding(.top, 6)
                }
                .fixedSize()
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("지도 행사 핀을 불러오는 중입니다")
                .accessibilityIdentifier("map-viewport-pin-loading")
            }
        }
        .frame(width: 104, height: 112, alignment: .topTrailing)
        .task(id: isLoading) {
            if isLoading {
                isVisible = true
            } else {
                // 취소 가능한 짧은 유예: 그 사이 렌더가 시작하면 숨김 작업이 취소된다.
                do { try await Task.sleep(nanoseconds: 200_000_000) }
                catch { return }
                guard !Task.isCancelled else { return }
                isVisible = false
            }
        }
        .onDisappear { isVisible = false }
    }

    @ViewBuilder
    private var loadingRing: some View {
        if reduceMotion {
            Image(systemName: "hourglass")
                .font(.system(size: 21, weight: .semibold))
                .foregroundStyle(FestivalDesign.coral)
        } else {
            SpinningMapLoadingRing()
        }
    }
}

private struct SpinningMapLoadingRing: View {
    @State private var isRotating = false

    var body: some View {
        ZStack {
            Circle().stroke(FestivalDesign.coral.opacity(0.18), lineWidth: 3)
            Circle()
                .trim(from: 0.05, to: 0.78)
                .stroke(FestivalDesign.coral, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                .rotationEffect(.degrees(isRotating ? 360 : 0))
                .animation(.linear(duration: 0.85).repeatForever(autoreverses: false), value: isRotating)
        }
        .onAppear { isRotating = true }
    }
}
