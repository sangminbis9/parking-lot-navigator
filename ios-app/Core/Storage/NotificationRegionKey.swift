import Foundation

/// 알림 관심 지역 키. 서버(`worker-backend/src/regionMatch.ts`)와 같은 형식을 쓴다.
///
///   "서울"        광역시도 전체
///   "서울|중구"   광역시도 + 시/군/구
///
/// 예전에는 "중구"·"고성군"처럼 이름만 저장하고 `address.contains(이름)`으로 판정했다.
/// 그래서 서울 중구와 부산 중구, 강원 고성군과 경남 고성군을 구분하지 못했고,
/// 중복 이름은 아예 좌표 매핑에서 빼야 해서 그만큼 알림이 통째로 누락됐다.
enum NotificationRegionKey {
    static let separator = "|"

    static func make(province: String, district: String?) -> String {
        guard let district, !district.isEmpty else { return province }
        return province + separator + district
    }

    static func split(_ key: String) -> (province: String, district: String?) {
        guard let range = key.range(of: separator) else { return (key, nil) }
        let district = String(key[range.upperBound...])
        return (String(key[..<range.lowerBound]), district.isEmpty ? nil : district)
    }

    /// UI 표시용 이름. "서울" / "서울 중구".
    static func displayName(_ key: String) -> String {
        let parts = split(key)
        guard let district = parts.district else { return parts.province }
        return "\(parts.province) \(FestivalFilter.cityDisplayName(district))"
    }

    /// 주소에서 (광역시도, 시/군/구)를 뽑는다. 서버 `parseRegion`과 같은 규칙이다.
    /// "인천광역시 연수구 …" → ("인천", "연수구"), "경기도 수원시 팔달구 …" → ("경기", "수원시").
    static func parse(address: String) -> (province: String?, district: String?) {
        let tokens = address.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        guard let head = tokens.first else { return (nil, nil) }
        let province = FestivalFilter.province(from: head)
        let district = tokens.dropFirst().first { token in
            token.count >= 2 && (token.hasSuffix("시") || token.hasSuffix("군") || token.hasSuffix("구"))
        }
        return (province, district)
    }

    /// 관심 지역 매칭. 선택된 지역이 하나도 없으면 전국 전체가 대상이므로 항상 true다.
    static func matches(address: String, regions: [String]) -> Bool {
        if regions.isEmpty { return true }
        let parsed = parse(address: address)
        guard let province = parsed.province else { return false }
        return regions.contains { key in
            let target = split(key)
            guard target.province == province else { return false }
            guard let district = target.district else { return true }
            return district == parsed.district
        }
    }

    /// 지역 키의 조회 중심 좌표. 시/군/구 이름이 전국에서 유일하면 그 좌표를,
    /// 중복 이름이라 좌표표에 없으면 광역시도 좌표를 쓴다.
    static func centroid(for key: String) -> (lat: Double, lng: Double)? {
        let parts = split(key)
        if let district = parts.district,
           let centroid = NotificationPreferencesStore.regionCentroids[district] {
            return centroid
        }
        return NotificationPreferencesStore.regionCentroids[parts.province]
    }

    /// 시/군/구 이름 → 그 이름을 가진 광역시도 목록. 중복 이름 판별에 쓴다.
    static let provincesByDistrict: [String: [String]] = {
        var map: [String: [String]] = [:]
        for region in FestivalFilter.regionHierarchy {
            for city in region.cities {
                map[city, default: []].append(region.name)
            }
        }
        return map
    }()

    /// 이름만 저장하던 예전 값을 정규화 키로 옮긴다. 이미 정규화된 키는 그대로 통과한다.
    /// 전국에서 유일한 시/군/구 이름만 광역시도를 붙일 수 있다. "중구"처럼 여러 광역시도에
    /// 걸친 이름은 어느 쪽을 고른 것인지 알 방법이 없어 버린다 — 임의로 하나를 고르거나
    /// 전부로 확장하면 사용자가 고르지 않은 지역의 알림이 간다.
    static func migrate(legacy: [String]) -> [String] {
        var result: [String] = []
        for value in legacy {
            if value.contains(separator) {
                if !result.contains(value) { result.append(value) }
                continue
            }
            if FestivalFilter.koreanRegions.contains(value) {
                if !result.contains(value) { result.append(value) }
                continue
            }
            guard let provinces = provincesByDistrict[value], provinces.count == 1 else { continue }
            let key = make(province: provinces[0], district: value)
            if !result.contains(key) { result.append(key) }
        }
        return result
    }
}
