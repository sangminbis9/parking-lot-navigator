import SwiftUI

/// 공유 시트에 넘길 링크와 문구.
struct DiscoverShareContent {
    let url: URL
    let title: String
    let message: String
}

extension DiscoverPresentation {
    /// 원문 링크가 있으면 그걸 공유하고, 없으면 앱으로 되돌아오는 딥링크를 공유한다.
    func shareContent(destinationId: String) -> DiscoverShareContent {
        let url: URL
        if let sourceUrl, let parsed = URL(string: sourceUrl) {
            url = parsed
        } else {
            url = DeepLinkRouter.shared.urlForDestination(id: destinationId)
        }
        let place = (venueName?.isEmpty == false ? venueName : nil) ?? address
        let message = [title, dateText, place]
            .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .joined(separator: "\n")
        return DiscoverShareContent(url: url, title: title, message: message)
    }
}

extension Festival {
    var shareContent: DiscoverShareContent {
        discoverPresentation.shareContent(destinationId: discoverDestination.id)
    }
}

extension FreeEvent {
    var shareContent: DiscoverShareContent {
        discoverPresentation.shareContent(destinationId: discoverDestination.id)
    }
}

/// 즐겨찾기 별 버튼과 같은 크기·톤으로 맞춘 공유 버튼.
struct DiscoverShareButton: View {
    let content: DiscoverShareContent
    var iconSize: CGFloat = 18
    var tapSize: CGFloat = 44

    var body: some View {
        ShareLink(item: content.url, subject: Text(content.title), message: Text(content.message)) {
            Image(systemName: "square.and.arrow.up")
                .font(.festival(size: iconSize, weight: .semibold))
                .foregroundStyle(FestivalDesign.secondaryText)
                .frame(width: tapSize, height: tapSize)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("공유")
    }
}
