import SwiftUI

struct MapHologramOverlay: View {
    let title: String
    let subtitle: String?
    let meta: String?
    let statusText: String?
    let imageUrl: String?
    let tint: Color
    let symbol: String
    let onDetails: () -> Void
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            cardBody
            beam
        }
        .compositingGroup()
        .shadow(color: FestivalDesign.teal.opacity(0.35), radius: 14, x: 0, y: 0)
        .shadow(color: FestivalDesign.navy.opacity(0.22), radius: 14, x: 0, y: 8)
    }

    private var cardBody: some View {
        Button(action: onDetails) {
            HStack(alignment: .top, spacing: 10) {
                DiscoverThumbnail(
                    imageUrl: imageUrl,
                    tint: tint,
                    symbol: symbol,
                    size: 64
                )
                .clipShape(RoundedRectangle(cornerRadius: 12))

                VStack(alignment: .leading, spacing: 4) {
                    if let statusText, !statusText.isEmpty {
                        Text(statusText)
                            .font(.system(size: 10, weight: .bold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 2)
                            .background(
                                Capsule().fill(tint)
                            )
                    }
                    Text(title)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(FestivalDesign.navy)
                        .lineLimit(1)
                    if let subtitle, !subtitle.isEmpty {
                        Text(subtitle)
                            .font(.system(size: 11))
                            .foregroundColor(FestivalDesign.secondaryText)
                            .lineLimit(1)
                    }
                    if let meta, !meta.isEmpty {
                        Text(meta)
                            .font(.system(size: 10))
                            .foregroundColor(FestivalDesign.secondaryText.opacity(0.85))
                            .lineLimit(1)
                    }
                    HStack(spacing: 3) {
                        Text("상세 보기")
                            .font(.system(size: 11, weight: .semibold))
                        Image(systemName: "arrow.right")
                            .font(.system(size: 10, weight: .bold))
                    }
                    .foregroundColor(tint)
                    .padding(.top, 2)
                }
                Spacer(minLength: 0)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                ZStack {
                    RoundedRectangle(cornerRadius: 16)
                        .fill(
                            LinearGradient(
                                colors: [
                                    Color.white.opacity(0.96),
                                    FestivalDesign.cream.opacity(0.92)
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                    RoundedRectangle(cornerRadius: 16)
                        .strokeBorder(
                            LinearGradient(
                                colors: [
                                    FestivalDesign.teal.opacity(0.85),
                                    tint.opacity(0.55),
                                    FestivalDesign.teal.opacity(0.85)
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            lineWidth: 1.4
                        )
                    scanLine
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                }
            )
            .overlay(alignment: .topTrailing) {
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(FestivalDesign.navy.opacity(0.7))
                        .frame(width: 22, height: 22)
                        .background(
                            Circle()
                                .fill(FestivalDesign.cream.opacity(0.95))
                                .overlay(
                                    Circle()
                                        .stroke(FestivalDesign.creamDeep.opacity(0.7), lineWidth: 0.5)
                                )
                        )
                }
                .buttonStyle(.plain)
                .padding(6)
            }
        }
        .buttonStyle(.plain)
    }

    private var scanLine: some View {
        GeometryReader { proxy in
            LinearGradient(
                colors: [
                    Color.clear,
                    FestivalDesign.teal.opacity(0.12),
                    Color.clear
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 28)
            .offset(y: proxy.size.height * 0.35)
        }
        .allowsHitTesting(false)
    }

    private var beam: some View {
        ZStack(alignment: .top) {
            Triangle()
                .fill(
                    LinearGradient(
                        colors: [
                            FestivalDesign.teal.opacity(0.7),
                            FestivalDesign.teal.opacity(0.0)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .frame(width: 22, height: 18)
        }
        .frame(height: 18)
        .allowsHitTesting(false)
    }
}

private struct Triangle: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.midX - rect.width * 0.5, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.midX + rect.width * 0.5, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}
