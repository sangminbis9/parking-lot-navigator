import Foundation
import os

/// 메인 스레드가 실제로 몇 ms 붙잡히는지 재는 계측 도구.
/// Instruments를 붙이면 os_signpost 트랙에 같은 구간이 그대로 뜨고, 붙이지 않아도
/// Xcode 콘솔(subsystem `com.parkingnav.perf`)에서 느린 구간과 메인 스레드 정지가 보인다.
enum PerfTrace {
    static let subsystem = "com.parkingnav.perf"

    private static let signposter = OSSignposter(subsystem: subsystem, category: "interval")
    private static let logger = Logger(subsystem: subsystem, category: "slow")

    /// 이 시간을 넘긴 구간만 콘솔에 남긴다. 한 프레임(16.7ms)보다 길면 화면이 끊긴 것이다.
    static let slowThreshold: TimeInterval = 0.016

    /// 구간 하나를 재고 결과를 돌려준다. 릴리스에서도 signpost는 남지만 비용은 무시할 수준이다.
    @discardableResult
    static func measure<T>(_ name: StaticString, _ detail: @autoclosure () -> String = "", _ body: () throws -> T) rethrows -> T {
        let id = signposter.makeSignpostID()
        let state = signposter.beginInterval(name, id: id)
        let started = CFAbsoluteTimeGetCurrent()
        defer {
            signposter.endInterval(name, state)
            let elapsed = CFAbsoluteTimeGetCurrent() - started
            if elapsed >= slowThreshold {
                // OSLog 보간은 인자를 escaping autoclosure로 받는다. autoclosure 파라미터를
                // 그대로 넘기면 컴파일이 막히므로 여기서 한 번 값으로 만든 뒤 넘긴다.
                let detailText = detail()
                logger.notice("\(name, privacy: .public) \(Int(elapsed * 1000), privacy: .public)ms \(detailText, privacy: .public)")
            }
        }
        return try body()
    }

    /// async 구간용. 네트워크 대기가 섞이면 값 자체는 메인 스레드 점유 시간이 아니라 총 소요다.
    @discardableResult
    static func measureAsync<T>(_ name: StaticString, _ detail: @autoclosure () -> String = "", _ body: () async -> T) async -> T {
        let id = signposter.makeSignpostID()
        let state = signposter.beginInterval(name, id: id)
        let started = CFAbsoluteTimeGetCurrent()
        let value = await body()
        signposter.endInterval(name, state)
        let elapsed = CFAbsoluteTimeGetCurrent() - started
        let detailText = detail()
        logger.notice("\(name, privacy: .public) \(Int(elapsed * 1000), privacy: .public)ms \(detailText, privacy: .public)")
        return value
    }

    /// 단발 이벤트. 구간이 아니라 "여기를 지나갔다"를 표시할 때.
    static func event(_ name: StaticString, _ detail: String = "") {
        signposter.emitEvent(name)
        logger.notice("event \(name, privacy: .public) \(detail, privacy: .public)")
    }

    fileprivate static func hangDetected(_ seconds: TimeInterval) {
        logger.error("main thread blocked >= \(Int(seconds * 1000), privacy: .public)ms")
    }

    fileprivate static func hangEnded(_ seconds: TimeInterval) {
        logger.error("main thread unblocked after \(Int(seconds * 1000), privacy: .public)ms")
    }
}

/// 메인 스레드 정지 감시. 백그라운드에서 20ms마다 메인 큐에 핑을 던지고,
/// 핑이 임계값 안에 돌아오지 않으면 그 사이를 "정지"로 기록한다.
/// Instruments의 Hangs와 같은 것을 보지만, 기기에서 콘솔만으로 확인할 수 있다.
final class MainThreadHangMonitor {
    static let shared = MainThreadHangMonitor()

    private let queue = DispatchQueue(label: "com.parkingnav.perf.hang", qos: .utility)
    private let lock = NSLock()
    private var timer: DispatchSourceTimer?
    private var pingSentAt: CFAbsoluteTime?
    private var reportedCurrentPing = false

    private init() {}

    func start(threshold: TimeInterval = 0.1) {
        guard timer == nil else { return }
        let source = DispatchSource.makeTimerSource(queue: queue)
        source.schedule(deadline: .now() + 0.5, repeating: 0.02, leeway: .milliseconds(5))
        source.setEventHandler { [weak self] in self?.tick(threshold: threshold) }
        source.resume()
        timer = source
    }

    private func tick(threshold: TimeInterval) {
        lock.lock()
        if let sentAt = pingSentAt {
            let stalled = CFAbsoluteTimeGetCurrent() - sentAt
            let shouldReport = stalled >= threshold && !reportedCurrentPing
            if shouldReport { reportedCurrentPing = true }
            lock.unlock()
            if shouldReport { PerfTrace.hangDetected(stalled) }
            return
        }
        pingSentAt = CFAbsoluteTimeGetCurrent()
        reportedCurrentPing = false
        lock.unlock()

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.lock.lock()
            let waited = self.pingSentAt.map { CFAbsoluteTimeGetCurrent() - $0 } ?? 0
            let reported = self.reportedCurrentPing
            self.pingSentAt = nil
            self.reportedCurrentPing = false
            self.lock.unlock()
            if reported { PerfTrace.hangEnded(waited) }
        }
    }
}
