import SwiftUI

struct MapHologramOverlay: View {
    let title: String
    let subtitle: String?
    let meta: String?
    let status: DiscoverStatus?
    /// 상세 화면과 같은 DiscoverTagBuilder 결과를 그대로 받는다. 카드 폭에 맞춰 앞쪽 몇 개만 보인다.
    let tags: [String]
    let imageUrl: String?
    let tint: Color
    let symbol: String
    var isFavorite: Bool = false
    var onToggleFavorite: (() -> Void)? = nil
    var shareContent: DiscoverShareContent? = nil
    var isSponsored: Bool = false
    let onDetails: () -> Void
    let onClose: () -> Void

    var body: some View {
        card
    }

    @ViewBuilder
    private var chipRow: some View {
        RegionFlowLayout(spacing: 5) {
            // 맨 앞 시기 태그만 토글 색을 그대로 채워 강조하고,
            // 뒤따르는 분류 태그들은 같은 색을 옅게 깔아 한 계열로 묶는다.
            if let status {
                Text(status.displayText)
                    .font(.festival(size: 10, weight: .bold))
                    .foregroundColor(FestivalDesign.onFill(tint))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(FestivalDesign.chipShape.fill(tint))
            }
            ForEach(Array(tags.prefix(3).enumerated()), id: \.offset) { _, tag in
                Text(tag)
                    .font(.festival(size: 10, weight: .medium))
                    .foregroundColor(FestivalDesign.readable(tint))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(FestivalDesign.chipShape.fill(tint.opacity(0.12)))
                    .lineLimit(1)
            }
        }
    }

    /// 우상단 버튼 줄이 차지하는 폭. 칩 줄이 그만큼 자리를 비운다.
    private var topButtonsWidth: CGFloat {
        let count = 1 + (onToggleFavorite != nil ? 1 : 0) + (shareContent != nil ? 1 : 0)
        return CGFloat(count) * 30 + CGFloat(count - 1) * 4
    }

    private var card: some View {
        ZStack(alignment: .topTrailing) {
            Button(action: onDetails) {
                VStack(alignment: .leading, spacing: 8) {
                    // 우상단 버튼 자리는 이 첫 줄에서만 비운다. 아래 본문은 카드 폭을 다 쓴다.
                    chipRow
                        .frame(minHeight: 30, alignment: .leading)
                        .padding(.trailing, topButtonsWidth)

                    HStack(alignment: .top, spacing: 10) {
                        DiscoverThumbnail(
                            imageUrl: imageUrl,
                            tint: tint,
                            symbol: symbol,
                            size: 60
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 10))

                        VStack(alignment: .leading, spacing: 4) {
                            Text(title)
                                .font(.festival(size: 14, weight: .semibold))
                                .foregroundColor(FestivalDesign.navy)
                                .lineLimit(2)
                                .fixedSize(horizontal: false, vertical: true)
                            if let subtitle, !subtitle.isEmpty {
                                Text(subtitle)
                                    .font(.festival(size: 11))
                                    .foregroundColor(FestivalDesign.secondaryText)
                                    .lineLimit(2)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            if let meta, !meta.isEmpty {
                                Text(meta)
                                    .font(.festival(size: 10))
                                    .foregroundColor(FestivalDesign.secondaryText.opacity(0.85))
                                    .lineLimit(2)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        Spacer(minLength: 0)
                    }

                    HStack(spacing: 3) {
                        Spacer(minLength: 0)
                        Text("상세 보기")
                            .font(.festival(size: 11, weight: .semibold))
                        Image(systemName: "arrow.right")
                            .font(.festival(size: 10, weight: .bold))
                    }
                    .foregroundColor(FestivalDesign.readable(tint))
                }
                .padding(10)
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
                if let shareContent {
                    ShareLink(
                        item: shareContent.url,
                        subject: Text(shareContent.title),
                        message: Text(shareContent.message)
                    ) {
                        Image(systemName: "square.and.arrow.up")
                            .font(.festival(size: 9, weight: .bold))
                            .foregroundColor(FestivalDesign.secondaryText)
                            .frame(width: 20, height: 20)
                            .background(Circle().fill(Color(.systemGray6)))
                            .frame(width: 30, height: 30)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("공유")
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
