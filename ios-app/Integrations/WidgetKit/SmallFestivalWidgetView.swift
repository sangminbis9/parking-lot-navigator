import SwiftUI
import UIKit

/// 작은 위젯: "지금 가장 가볼 만한 축제" 하나만 보여준다.
/// 탭 영역이 하나뿐이라 카드별 Link 대신 `widgetURL`로 그 축제 하나만 연결한다.
struct SmallFestivalWidgetView: View {
    let entry: UpcomingFestivalsEntry
    let festival: Festival

    var body: some View {
        let thumbnail = WidgetThumbnailLoader.image(for: festival.id)
        return ZStack(alignment: .topLeading) {
            background(thumbnail)
            content(hasImage: thumbnail != nil)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .widgetURL(WidgetFormat.deepLink(festival))
    }

    @ViewBuilder
    private func background(_ thumbnail: UIImage?) -> some View {
        if let thumbnail {
            // 사진 위에 글자를 얹으므로 아래쪽을 어둡게 깔아 가독성을 확보한다.
            ZStack {
                Image(uiImage: thumbnail)
                    .resizable()
                    .scaledToFill()
                LinearGradient(
                    colors: [Color.black.opacity(0.08), Color.black.opacity(0.72)],
                    startPoint: .top,
                    endPoint: .bottom
                )
            }
            .clipped()
        } else {
            FestivalDesign.surface
        }
    }

    private func content(hasImage: Bool) -> some View {
        let primary = hasImage ? Color.white : FestivalDesign.navy
        let secondary = hasImage ? Color.white.opacity(0.85) : FestivalDesign.secondaryText

        return VStack(alignment: .leading, spacing: 3) {
            statusChip(hasImage: hasImage)
            Spacer(minLength: 2)
            Text(festival.title)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(primary)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
            Text(WidgetFormat.dateRangeText(festival))
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(secondary)
                .lineLimit(1)
            if let place = WidgetFormat.placeText(festival) {
                Text(place)
                    .font(.system(size: 9))
                    .foregroundStyle(secondary)
                    .lineLimit(1)
            }
            Text(footerText)
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(secondary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
        .padding(12)
    }

    private func statusChip(hasImage: Bool) -> some View {
        Text(WidgetFormat.statusText(festival, now: entry.date))
            .font(.system(size: 9, weight: .bold))
            .foregroundStyle(hasImage ? Color.white : WidgetFormat.statusColor(festival))
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(
                Capsule().fill(
                    hasImage
                        ? WidgetFormat.statusDotColor(festival).opacity(0.9)
                        : WidgetFormat.statusDotColor(festival).opacity(0.22)
                )
            )
    }

    /// 기준 라벨 + 거리. 거리는 사용자 위치 기준일 때만 의미가 있다.
    private var footerText: String {
        if let distance = WidgetFormat.distanceText(festival, basis: entry.basisKind) {
            return "\(entry.basisLabel) · \(distance)"
        }
        return entry.basisLabel
    }
}
