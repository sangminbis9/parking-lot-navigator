import SwiftUI
import ImageIO
import UIKit

/// 디코드(다운샘플)된 UIImage를 메모리에 캐시해 리스트 스크롤 시 재디코드를 막는다.
/// 네트워크/디스크 캐시는 앱 시작 시 상향한 `URLCache.shared`에 위임한다.
final class RemoteImageCache {
    static let shared = RemoteImageCache()

    private let memory = NSCache<NSString, UIImage>()
    private let session: URLSession

    private init() {
        memory.countLimit = 300
        memory.totalCostLimit = 80 * 1024 * 1024
        session = URLSession(configuration: .default)
    }

    private func key(_ url: URL, maxPixel: CGFloat) -> NSString {
        "\(url.absoluteString)|\(Int(maxPixel))" as NSString
    }

    /// 이미 메모리에 있으면 즉시 반환(placeholder 깜빡임 방지용).
    func cached(_ url: URL, maxPixel: CGFloat) -> UIImage? {
        memory.object(forKey: key(url, maxPixel: maxPixel))
    }

    func load(_ url: URL, maxPixel: CGFloat) async -> UIImage? {
        let cacheKey = key(url, maxPixel: maxPixel)
        if let hit = memory.object(forKey: cacheKey) { return hit }
        do {
            let (data, _) = try await session.data(from: url)
            guard let image = Self.decode(data, maxPixel: maxPixel) else { return nil }
            memory.setObject(image, forKey: cacheKey, cost: Self.cost(of: image))
            return image
        } catch {
            return nil
        }
    }

    private static func cost(of image: UIImage) -> Int {
        let size = image.size
        return Int(size.width * size.height * image.scale * image.scale * 4)
    }

    /// maxPixel > 0이면 ImageIO 썸네일로 다운샘플, 아니면 원본 디코드.
    private static func decode(_ data: Data, maxPixel: CGFloat) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else {
            return UIImage(data: data)
        }
        if maxPixel <= 0 {
            guard let cg = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
                return UIImage(data: data)
            }
            return UIImage(cgImage: cg)
        }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            return UIImage(data: data)
        }
        return UIImage(cgImage: cg)
    }
}

/// 다운샘플 + 메모리 캐시를 적용한 이미지 뷰. `AsyncImage`의 경량 대체.
/// `downsamplePoints`는 표시 크기(pt)이며 내부에서 화면 스케일을 곱해 픽셀 상한을 만든다.
/// 0 이하이면 원본 해상도로 로드한다(전체화면 뷰어용).
struct RemoteImage<Placeholder: View>: View {
    private let url: URL?
    private let maxPixel: CGFloat
    private let contentMode: ContentMode
    private let placeholder: Placeholder

    @State private var loaded: UIImage?

    init(
        url: URL?,
        downsamplePoints: CGFloat,
        contentMode: ContentMode = .fill,
        @ViewBuilder placeholder: () -> Placeholder
    ) {
        self.url = url
        self.contentMode = contentMode
        self.placeholder = placeholder()
        let maxPixel = downsamplePoints > 0 ? downsamplePoints * UIScreen.main.scale : 0
        self.maxPixel = maxPixel
        // 캐시 히트 시 첫 프레임부터 이미지를 보여줘 스크롤 재등장 깜빡임을 없앤다.
        if let url {
            _loaded = State(initialValue: RemoteImageCache.shared.cached(url, maxPixel: maxPixel))
        } else {
            _loaded = State(initialValue: nil)
        }
    }

    var body: some View {
        Group {
            if let loaded {
                Image(uiImage: loaded)
                    .resizable()
                    .aspectRatio(contentMode: contentMode)
            } else {
                placeholder
            }
        }
        .task(id: taskID) {
            guard loaded == nil, let url else { return }
            let image = await RemoteImageCache.shared.load(url, maxPixel: maxPixel)
            if !Task.isCancelled { loaded = image }
        }
    }

    private var taskID: String { "\(url?.absoluteString ?? "nil")|\(Int(maxPixel))" }
}
