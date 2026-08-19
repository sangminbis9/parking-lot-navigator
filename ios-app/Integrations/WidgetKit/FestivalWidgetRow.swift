import SwiftUI

/// 중간·큰 위젯이 공유하는 한 줄 카드. 썸네일 + 축제명 + 상태·날짜·장소를 담는다.
struct FestivalWidgetRow: View {
    let festival: Festival
    let now: Date
    let basis: WidgetBasisKind
    var thumbnailSize: CGFloat = 30
    var showsBackground: Bool = true

    var body: some View {
        HStack(spacing: 8) {
            FestivalWidgetImage(festival: festival, cornerRadius: 7)
                .frame(width: thumbnailSize, height: thumbnailSize)
            VStack(alignment: .leading, spacing: 1) {
                Text(festival.title)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(FestivalDesign.navy)
                    .lineLimit(1)
                HStack(spacing: 4) {
                    Text(WidgetFormat.statusText(festival, now: now))
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(WidgetFormat.statusColor(festival))
                    Text(metaText)
                        .font(.system(size: 9))
                        .foregroundStyle(FestivalDesign.secondaryText)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, showsBackground ? 6 : 0)
        .padding(.vertical, showsBackground ? 4 : 0)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(showsBackground ? FestivalDesign.cream.opacity(0.45) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 9))
    }

    /// 날짜 · 장소 · 거리. 한 줄에 넣어야 해서 있는 것만 이어 붙인다.
    private var metaText: String {
        var parts = [WidgetFormat.dateRangeText(festival)]
        if let place = WidgetFormat.placeText(festival) { parts.append(place) }
        if let distance = WidgetFormat.distanceText(festival, basis: basis) { parts.append(distance) }
        return parts.joined(separator: " · ")
    }
}
