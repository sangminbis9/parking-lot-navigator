import Foundation

/// 위젯 확장 타깃에는 네트워킹 코드가 없어 `AsyncImage`로 축제 사진을 받아올 수 없다.
/// 앱이 sync 단계에서 작게 줄인 JPEG을 App Group 컨테이너에 넣어 두고, 위젯은 파일만 읽는다.
enum WidgetThumbnailStore {
    static let directoryName = "widget_thumbs"

    static func directoryURL(appGroupID: String) -> URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroupID)?
            .appendingPathComponent(directoryName, isDirectory: true)
    }

    static func fileURL(festivalID: String, appGroupID: String) -> URL? {
        directoryURL(appGroupID: appGroupID)?
            .appendingPathComponent("\(safeName(festivalID)).jpg")
    }

    static func hasThumbnail(festivalID: String, appGroupID: String) -> Bool {
        guard let url = fileURL(festivalID: festivalID, appGroupID: appGroupID) else { return false }
        return FileManager.default.fileExists(atPath: url.path)
    }

    static func write(_ data: Data, festivalID: String, appGroupID: String) {
        guard let directory = directoryURL(appGroupID: appGroupID),
              let url = fileURL(festivalID: festivalID, appGroupID: appGroupID) else { return }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? data.write(to: url, options: .atomic)
    }

    /// 스냅샷에서 빠진 축제의 썸네일은 지운다. 안 지우면 컨테이너가 계속 커진다.
    static func prune(keeping festivalIDs: [String], appGroupID: String) {
        guard let directory = directoryURL(appGroupID: appGroupID),
              let files = try? FileManager.default.contentsOfDirectory(
                at: directory,
                includingPropertiesForKeys: nil
              ) else { return }
        let keep = Set(festivalIDs.map { "\(safeName($0)).jpg" })
        for file in files where !keep.contains(file.lastPathComponent) {
            try? FileManager.default.removeItem(at: file)
        }
    }

    /// 축제 id에는 공백·슬래시가 섞여 있어 파일명으로 바로 못 쓴다.
    /// 영숫자만 남기고, 잘라내며 생기는 충돌을 막으려 원본 해시를 덧붙인다.
    private static func safeName(_ id: String) -> String {
        let sanitized = String(String(id.unicodeScalars.map {
            CharacterSet.alphanumerics.contains($0) ? Character($0) : "-"
        }).prefix(48))
        var hash: UInt64 = 5381
        for byte in Array(id.utf8) {
            hash = hash &* 33 &+ UInt64(byte)
        }
        return "\(sanitized)-\(String(hash, radix: 36))"
    }
}
