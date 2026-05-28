import SwiftUI

struct MapHologramOverlay: View {
    let title: String
    let subtitle: String?
    let meta: String?
    let statusText: String?
    let categoryText: String?
    let imageUrl: String?
    let tint: Color
    let symbol: String
    let onDetails: () -> Void
    let onClose: () -> Void

    var body: some View {
        card
    }

    private var card: some View {
        ZStack(alignment: .topTrailing) {
            Button(action: onDetails) {
                HStack(alignment: .top, spacing: 10) {
                    DiscoverThumbnail(
                        imageUrl: imageUrl,
                        tint: tint,
                        symbol: symbol,
                        size: 60
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 10))

                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 5) {
                            if let statusText, !statusText.isEmpty {
                                Text(statusText)
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundColor(.white)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(Capsule().fill(tint))
                            }
                            if let categoryText, !categoryText.isEmpty {
                                Text(categoryText)
                                    .font(.system(size: 10, weight: .medium))
                                    .foregroundColor(tint)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(Capsule().fill(tint.opacity(0.12)))
                            }
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
                        .padding(.top, 1)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.top, 10)
                .padding(.leading, 10)
                .padding(.bottom, 10)
                .padding(.trailing, 34)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)

            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundColor(FestivalDesign.secondaryText)
                    .frame(width: 20, height: 20)
                    .background(Circle().fill(Color(.systemGray6)))
            }
            .buttonStyle(.plain)
            .padding(8)
        }
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .shadow(color: Color.black.opacity(0.14), radius: 14, x: 0, y: 5)
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(Color.black.opacity(0.07), lineWidth: 1)
        )
    }

    private var connector: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(
                    LinearGradient(
                        colors: [tint.opacity(0.35), tint.opacity(0.7)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .frame(width: 2, height: 20)
            Circle()
                .fill(tint)
                .frame(width: 6, height: 6)
        }
        .allowsHitTesting(false)
    }
}
