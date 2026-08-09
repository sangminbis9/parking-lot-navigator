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
    var isFavorite: Bool = false
    var onToggleFavorite: (() -> Void)? = nil
    var isSponsored: Bool = false
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
                                    .font(.festival(size: 10, weight: .bold))
                                    .foregroundColor(FestivalDesign.onFill(tint))
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(FestivalDesign.chipShape.fill(tint))
                            }
                            if let categoryText, !categoryText.isEmpty {
                                Text(categoryText)
                                    .font(.festival(size: 10, weight: .medium))
                                    .foregroundColor(FestivalDesign.readable(tint))
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(FestivalDesign.chipShape.fill(tint.opacity(0.12)))
                            }
                        }
                        Text(title)
                            .font(.festival(size: 14, weight: .semibold))
                            .foregroundColor(FestivalDesign.navy)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                        if let subtitle, !subtitle.isEmpty {
                            Text(subtitle)
                                .font(.festival(size: 11))
                                .foregroundColor(FestivalDesign.secondaryText)
                                .lineLimit(1)
                        }
                        if let meta, !meta.isEmpty {
                            Text(meta)
                                .font(.festival(size: 10))
                                .foregroundColor(FestivalDesign.secondaryText.opacity(0.85))
                                .lineLimit(2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        HStack(spacing: 3) {
                            Text("상세 보기")
                                .font(.festival(size: 11, weight: .semibold))
                            Image(systemName: "arrow.right")
                                .font(.festival(size: 10, weight: .bold))
                        }
                        .foregroundColor(FestivalDesign.readable(tint))
                        .padding(.top, 1)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.top, 10)
                .padding(.leading, 10)
                .padding(.bottom, 10)
                // 우상단 버튼(각 30pt + 간격 4 + 패딩 8)이 본문 위에 겹치지 않도록 자리를 비워 둔다.
                .padding(.trailing, onToggleFavorite != nil ? 76 : 50)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)

            HStack(spacing: 4) {
                if let onToggleFavorite {
                    Button(action: onToggleFavorite) {
                        Image(systemName: isFavorite ? "star.fill" : "star")
                            .font(.festival(size: 9, weight: .bold))
                            .foregroundColor(isFavorite ? FestivalDesign.lanternText : FestivalDesign.secondaryText)
                            .frame(width: 20, height: 20)
                            .background(Circle().fill(Color(.systemGray6)))
                            .frame(width: 30, height: 30)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(isFavorite ? "관심 축제 해제" : "관심 축제로 저장")
                }
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.festival(size: 9, weight: .bold))
                        .foregroundColor(FestivalDesign.secondaryText)
                        .frame(width: 20, height: 20)
                        .background(Circle().fill(Color(.systemGray6)))
                        .frame(width: 30, height: 30)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("카드 닫기")
            }
            .padding(8)
        }
        .background(FestivalDesign.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .festivalShadow(.high)
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(
                    isSponsored ? FestivalDesign.lantern : FestivalDesign.creamDeep.opacity(0.45),
                    lineWidth: isSponsored ? 1.5 : 1
                )
        )
    }
}
