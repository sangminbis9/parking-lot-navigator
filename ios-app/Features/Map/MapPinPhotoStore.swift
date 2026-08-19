import SwiftUI
import UIKit

/// 지도 핀 배지에 넣을 행사 대표 이미지를 공급한다.
/// `MapPinRenderer`가 동기 렌더러라 이미 메모리에 있는 이미지만 그 자리에서 쓸 수 있다.
/// 없으면 백그라운드로 받아 두고, 받아진 뒤 `@Published` 변경으로 지도를 다시 그려 그때 핀에 넣는다.
@MainActor
final class MapPinPhotoStore: ObservableObject {
    /// 배지 한 변이 42pt이고 0.5 scale로 그려지므로 128px이면 충분하다.
    private static let maxPixel: CGFloat = 128

    /// 로드가 끝났음을 알리는 신호. 값 자체는 쓰지 않고 재렌더 트리거로만 쓴다.
    @Published private var loadedGeneration = 0
    private var inFlight: Set<String> = []
    /// 실패한 URL. 그냥 두면 실패 → 재렌더 → 재시도가 무한히 돈다.
    private var failed: Set<String> = []

    func photo(for urlString: String?) -> MapPinPhoto? {
        guard let urlString, !urlString.isEmpty, let url = URL(string: urlString) else { return nil }
        if let image = RemoteImageCache.shared.cached(url, maxPixel: Self.maxPixel) {
            return MapPinPhoto(key: Self.styleKey(urlString), image: image)
        }
        guard !failed.contains(urlString), inFlight.insert(urlString).inserted else { return nil }
        Task { @MainActor in
            let image = await RemoteImageCache.shared.load(url, maxPixel: Self.maxPixel)
            inFlight.remove(urlString)
            if image == nil {
                failed.insert(urlString)
            } else {
                loadedGeneration += 1
            }
        }
        return nil
    }

    /// styleID에 넣을 URL 지문. 실행 간 안정성은 필요 없고 한 세션 안에서 일관되기만 하면 된다.
    private static func styleKey(_ urlString: String) -> String {
        let hash = urlString.unicodeScalars.reduce(UInt32(2166136261)) { partial, scalar in
            (partial ^ scalar.value) &* 16777619
        }
        return String(hash, radix: 16)
    }
}
