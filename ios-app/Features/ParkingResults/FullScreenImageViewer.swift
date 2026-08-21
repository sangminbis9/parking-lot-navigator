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
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("닫기")
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
/// 이미지 전체가 화면에 들어오는 배율에서 시작하고, 확대는 자유롭게 할 수 있다.
private struct ZoomableScrollView: UIViewRepresentable {
    let image: UIImage

    func makeUIView(context: Context) -> ZoomableImageScrollView {
        let scrollView = ZoomableImageScrollView()
        scrollView.displayImage = image
        return scrollView
    }

    func updateUIView(_ scrollView: ZoomableImageScrollView, context: Context) {
        if scrollView.displayImage !== image {
            scrollView.displayImage = image
        }
    }
}

/// 배율 계산을 `layoutSubviews`에서 하는 게 핵심이다. UIViewRepresentable의 `updateUIView`는
/// 스크롤뷰 bounds가 아직 0인 시점에 불려서, 거기서 프레임을 잡으면 원본 크기 그대로 남아
/// 확대된 상태로 열린다.
private final class ZoomableImageScrollView: UIScrollView, UIScrollViewDelegate {
    private let imageView = UIImageView()
    private var fittedFor: CGSize = .zero

    var displayImage: UIImage? {
        didSet {
            imageView.image = displayImage
            fittedFor = .zero
            setNeedsLayout()
        }
    }

    init() {
        super.init(frame: .zero)
        delegate = self
        bouncesZoom = true
        showsVerticalScrollIndicator = false
        showsHorizontalScrollIndicator = false
        backgroundColor = .clear
        contentInsetAdjustmentBehavior = .never

        imageView.contentMode = .scaleAspectFit
        imageView.isUserInteractionEnabled = true
        addSubview(imageView)

        let doubleTap = UITapGestureRecognizer(target: self, action: #selector(handleDoubleTap(_:)))
        doubleTap.numberOfTapsRequired = 2
        imageView.addGestureRecognizer(doubleTap)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func layoutSubviews() {
        super.layoutSubviews()
        fitImageIfNeeded()
        centerContent()
    }

    /// 화면 크기나 이미지가 바뀐 순간에만 배율을 다시 잡는다. 여기서 zoomScale을 건드리면
    /// layoutSubviews가 다시 도니, 같은 조건에서는 재실행되지 않게 fittedFor로 막는다.
    private func fitImageIfNeeded() {
        guard let image = displayImage,
              image.size.width > 0, image.size.height > 0,
              bounds.width > 0, bounds.height > 0,
              fittedFor != bounds.size else { return }
        fittedFor = bounds.size

        // 원본 픽셀 좌표계로 되돌린 뒤 다시 계산한다(이전 배율이 남아 있으면 프레임이 어긋난다).
        minimumZoomScale = 0.01
        maximumZoomScale = 100
        zoomScale = 1
        imageView.frame = CGRect(origin: .zero, size: image.size)
        contentSize = image.size

        let fitScale = min(bounds.width / image.size.width, bounds.height / image.size.height)
        minimumZoomScale = fitScale
        // 가로/세로 꽉 찬 상태의 3배까지. 작은 이미지도 최소 2배는 확대할 수 있게 둔다.
        maximumZoomScale = max(fitScale * 3, 2)
        zoomScale = fitScale
    }

    /// 확대/축소 시 이미지를 화면 중앙에 유지한다.
    private func centerContent() {
        let offsetX = max((bounds.width - contentSize.width) / 2, 0)
        let offsetY = max((bounds.height - contentSize.height) / 2, 0)
        contentInset = UIEdgeInsets(top: offsetY, left: offsetX, bottom: offsetY, right: offsetX)
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

    func scrollViewDidZoom(_ scrollView: UIScrollView) { centerContent() }

    @objc private func handleDoubleTap(_ gesture: UITapGestureRecognizer) {
        if zoomScale > minimumZoomScale {
            setZoomScale(minimumZoomScale, animated: true)
            return
        }
        // 탭한 지점을 중심으로 확대한다.
        let target = min(minimumZoomScale * 3, maximumZoomScale)
        let point = gesture.location(in: imageView)
        let size = CGSize(width: bounds.width / target, height: bounds.height / target)
        zoom(
            to: CGRect(
                x: point.x - size.width / 2,
                y: point.y - size.height / 2,
                width: size.width,
                height: size.height
            ),
            animated: true
        )
    }
}
