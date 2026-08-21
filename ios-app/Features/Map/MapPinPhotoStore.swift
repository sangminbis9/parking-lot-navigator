import SwiftUI
import UIKit

/// 지도 핀 배지에 넣을 행사 대표 이미지를 공급한다.
/// `MapPinRenderer`가 동기 렌더러라 이미 메모리에 있는 이미지만 그 자리에서 쓸 수 있다.
/// 없으면 백그라운드로 받아 두고, 받아진 뒤 `@Published` 변경으로 지도를 다시 그려 그때 핀에 넣는다.
@MainActor
final class MapPinPhotoStore: ObservableObject {
    /// 배지 한 변이 42pt이고 0.5 scale로 그려지므로 128px이면 충분하다.
    private static let maxPixel: CGFloat = 128

    /// 한 번에 받는 장수. 콜드 스타트에 수십 장이 동시에 들어오면 도착도 한꺼번에 몰려
    /// 핀 스타일을 그 수만큼 한 프레임에 그리게 된다. 몇 장씩 나눠 받아 부하를 흩는다.
    private static let maxConcurrentLoads = 4
    /// 실패한 URL을 다시 시도하기까지의 간격.
    private static let retryInterval: TimeInterval = 60

    /// 로드가 끝났음을 알리는 신호. 값 자체는 쓰지 않고 재렌더 트리거로만 쓴다.
    @Published private(set) var loadedGeneration = 0
    private var inFlight: Set<String> = []
    private var queued: [String] = []
    private var queuedKeys: Set<String> = []
    /// 실패 시각. 영구히 막으면 콜드 스타트에 네트워크가 늦게 붙은 행사는 그 세션 내내 사진이 없다.
    private var failedAt: [String: Date] = [:]
    /// 도착 알림을 묶는 타이머. 한 장마다 알리면 그때마다 지도 핀 파이프라인이 통째로 다시 계산된다.
    private var bumpTask: Task<Void, Never>?

    func photo(for urlString: String?) -> MapPinPhoto? {
        guard let urlString, !urlString.isEmpty, let url = URL(string: urlString) else { return nil }
        if let image = RemoteImageCache.shared.cached(url, maxPixel: Self.maxPixel) {
            return MapPinPhoto(key: Self.styleKey(urlString), image: image)
        }
        guard !inFlight.contains(urlString), !queuedKeys.contains(urlString) else { return nil }
        if let failedAt = failedAt[urlString], Date().timeIntervalSince(failedAt) < Self.retryInterval {
            return nil
        }
        queued.append(urlString)
        queuedKeys.insert(urlString)
        startNextLoads()
        return nil
    }

    private func startNextLoads() {
        while inFlight.count < Self.maxConcurrentLoads, !queued.isEmpty {
            let urlString = queued.removeFirst()
            queuedKeys.remove(urlString)
            guard let url = URL(string: urlString) else { continue }
            inFlight.insert(urlString)
            Task { @MainActor [weak self] in
                let image = await RemoteImageCache.shared.load(url, maxPixel: Self.maxPixel)
                guard let self else { return }
                self.inFlight.remove(urlString)
                if image == nil {
                    self.failedAt[urlString] = Date()
                } else {
                    self.failedAt.removeValue(forKey: urlString)
                    self.scheduleGenerationBump()
                }
                self.startNextLoads()
            }
        }
    }

    /// 앱을 새로 열거나 다른 앱에서 돌아오면 메모리 캐시가 비어 수십 장이 한꺼번에 도착한다.
    /// 한 장마다 재계산하면 그 동안 지도가 멈춘 것처럼 보이므로 묶어서 알린다.
    /// 알림 한 번이 핀 파이프라인 전체 재계산이라, 콜드 스타트에는 간격이 넓을수록 이득이 크다.
    private func scheduleGenerationBump() {
        guard bumpTask == nil else { return }
        bumpTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 800_000_000)
            guard let self else { return }
            self.bumpTask = nil
            self.loadedGeneration += 1
        }
    }

    /// styleID에 넣을 URL 지문. 실행 간 안정성은 필요 없고 한 세션 안에서 일관되기만 하면 된다.
    private static func styleKey(_ urlString: String) -> String {
        let hash = urlString.unicodeScalars.reduce(UInt32(2166136261)) { partial, scalar in
            (partial ^ scalar.value) &* 16777619
        }
        return String(hash, radix: 16)
    }
}
