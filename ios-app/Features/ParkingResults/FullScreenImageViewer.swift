import SwiftUI
import UIKit

/// 상세 히어로 이미지를 탭했을 때 원본 화질로 보여주는 전체화면 뷰어.
/// 핀치 확대/축소, 더블탭 줌, 여러 장이면 좌우 스와이프를 지원한다.
struct FullScreenImageViewer: View {
    let urls: [URL]
    @Environment(\.dismiss) private var dismiss
    @State private var selection: Int

    init(urls: [URL], startIndex: Int = 0) {
        self.urls = urls
        _selection = State(initialValue: min(max(startIndex, 0), max(urls.count - 1, 0)))
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()

            TabView(selection: $selection) {
                ForEach(Array(urls.enumerated()), id: \.offset) { index, url in
                    ZoomableImagePage(url: url)
                        .tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: urls.count > 1 ? .automatic : .never))
            .ignoresSafeArea()

            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 38, height: 38)
                    .background(.black.opacity(0.45), in: Circle())
            }
            .padding(.top, 12)
            .padding(.trailing, 16)
        }
        .statusBarHidden(true)
    }
}

/// 한 장을 로드해 확대 가능한 스크롤 뷰에 담는다.
private struct ZoomableImagePage: View {
    let url: URL
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                ZoomableScrollView(image: image)
            } else {
                ProgressView()
                    .tint(.white)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: url) {
            // 확대 시 화질을 위해 원본에 가깝게 로드(과도한 메모리는 상한으로 방지).
            image = await RemoteImageCache.shared.load(url, maxPixel: 3000)
        }
    }
}

/// UIScrollView 기반 네이티브 핀치 줌 + 더블탭 줌 뷰.
private struct ZoomableScrollView: UIViewRepresentable {
    let image: UIImage

    func makeUIView(context: Context) -> UIScrollView {
        let scrollView = UIScrollView()
        scrollView.delegate = context.coordinator
        scrollView.minimumZoomScale = 1
        scrollView.maximumZoomScale = 4
        scrollView.bouncesZoom = true
        scrollView.showsVerticalScrollIndicator = false
        scrollView.showsHorizontalScrollIndicator = false
        scrollView.backgroundColor = .clear
        scrollView.contentInsetAdjustmentBehavior = .never

        let imageView = UIImageView(image: image)
        imageView.contentMode = .scaleAspectFit
        imageView.isUserInteractionEnabled = true
        scrollView.addSubview(imageView)
        context.coordinator.imageView = imageView

        let doubleTap = UITapGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handleDoubleTap(_:))
        )
        doubleTap.numberOfTapsRequired = 2
        imageView.addGestureRecognizer(doubleTap)

        return scrollView
    }

    func updateUIView(_ scrollView: UIScrollView, context: Context) {
        context.coordinator.imageView?.image = image
        context.coordinator.layout(in: scrollView)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, UIScrollViewDelegate {
        weak var imageView: UIImageView?

        func layout(in scrollView: UIScrollView) {
            guard let imageView else { return }
            let size = scrollView.bounds.size
            guard size.width > 0, size.height > 0 else { return }
            if imageView.frame.size != size {
                imageView.frame = CGRect(origin: .zero, size: size)
                scrollView.contentSize = size
            }
        }

        func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

        func scrollViewDidZoom(_ scrollView: UIScrollView) {
            // 확대/축소 시 이미지를 화면 중앙에 유지한다.
            let offsetX = max((scrollView.bounds.width - scrollView.contentSize.width) / 2, 0)
            let offsetY = max((scrollView.bounds.height - scrollView.contentSize.height) / 2, 0)
            scrollView.contentInset = UIEdgeInsets(top: offsetY, left: offsetX, bottom: 0, right: 0)
        }

        @objc func handleDoubleTap(_ gesture: UITapGestureRecognizer) {
            guard let scrollView = imageView?.superview as? UIScrollView else { return }
            if scrollView.zoomScale > scrollView.minimumZoomScale {
                scrollView.setZoomScale(scrollView.minimumZoomScale, animated: true)
            } else {
                scrollView.setZoomScale(scrollView.maximumZoomScale, animated: true)
            }
        }
    }
}
