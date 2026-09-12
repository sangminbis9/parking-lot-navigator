import Foundation

/// Immutable, coarse spatial index. The grid narrows work, not result count.
/// A nationwide query includes every cell; no prefix/slice cap is applied.
final class DiscoverySnapshotIndex {
    let festivalByID: [String: Festival]
    let eventByID: [String: FreeEvent]
    private let festivalsByCell: [Cell: [Festival]]
    private let performancesByCell: [Cell: [FreeEvent]]
    private let eventsByCell: [Cell: [FreeEvent]]

    private struct Cell: Hashable {
        let lat: Int
        let lng: Int
        init(_ lat: Double, _ lng: Double) {
            self.lat = Int(floor(lat * 2))
            self.lng = Int(floor(lng * 2))
        }
    }
    init(parts: [DiscoverySnapshotPart]) {
        var festivals: [String: Festival] = [:]
        var events: [String: FreeEvent] = [:]
        var performances: [String: FreeEvent] = [:]
        for part in parts {
            for item in part.festivals { festivals[item.id] = item }
            for item in part.localEvents { events[item.id] = item }
            for item in part.performanceEvents { performances[item.id] = item }
        }
        festivalByID = festivals
        eventByID = events
        festivalsByCell = Dictionary(grouping: festivals.values) { Cell($0.lat, $0.lng) }
        eventsByCell = Dictionary(grouping: events.values) { Cell($0.lat, $0.lng) }
        performancesByCell = Dictionary(grouping: performances.values) { Cell($0.lat, $0.lng) }
    }

    func festival(id: String, now: Date) -> Festival? {
        guard var item = festivalByID[id] else { return nil }
        item.status = !item.startDate.isEmpty && String(item.startDate.prefix(10)) <= Dates(now).today ? .ongoing : .upcoming
        return item
    }

    func festivals(lat: Double, lng: Double, radius: Int, upcoming: Int, past: Int, now: Date) -> [Festival] {
        let dates = Dates(now)
        return candidates(festivalsByCell, lat: lat, lng: lng, radius: radius).compactMap { item -> Festival? in
            guard dates.matches(start: item.startDate, end: item.endDate, upcoming: upcoming, past: past) else { return nil }
            let distance = Self.distance(lat, lng, item.lat, item.lng)
            guard distance <= Double(radius) else { return nil }
            var copy = item
            copy.distanceMeters = Int(distance.rounded())
            copy.status = !item.startDate.isEmpty && String(item.startDate.prefix(10)) <= dates.today ? .ongoing : .upcoming
            return copy
        }.sorted {
            if $0.status != $1.status { return $0.status == .ongoing }
            if $0.distanceMeters != $1.distanceMeters { return $0.distanceMeters < $1.distanceMeters }
            return $0.id < $1.id
        }
    }

    func performances(lat: Double, lng: Double, radius: Int, upcoming: Int, now: Date) -> (festivals: [Festival], events: [FreeEvent]) {
        let dates = Dates(now)
        let festivals = self.festivals(lat: lat, lng: lng, radius: radius, upcoming: upcoming, past: 0, now: now)
            .filter { $0.primaryCategory == .musicPerformance && !DiscoverDomain.performanceSources.contains($0.source) }
        let events: [FreeEvent] = candidates(performancesByCell, lat: lat, lng: lng, radius: radius).compactMap { item -> FreeEvent? in
            guard dates.matches(start: item.startDate, end: item.endDate, upcoming: upcoming, past: 0) else { return nil }
            let distance = Self.distance(lat, lng, item.lat, item.lng)
            guard distance <= Double(radius) else { return nil }
            var copy = item
            copy.distanceMeters = Int(distance.rounded())
            return copy
        }.sorted {
            let lhsOngoing = $0.startDate <= dates.today
            let rhsOngoing = $1.startDate <= dates.today
            if lhsOngoing != rhsOngoing { return lhsOngoing }
            if $0.distanceMeters != $1.distanceMeters { return $0.distanceMeters < $1.distanceMeters }
            return $0.id < $1.id
        }
        return (festivals, events)
    }

    func events(lat: Double, lng: Double, radius: Int, now: Date) -> [FreeEvent] {
        let dates = Dates(now)
        return candidates(eventsByCell, lat: lat, lng: lng, radius: radius).compactMap { item -> FreeEvent? in
            guard item.status == .approved else { return nil }
            if item.isSponsored {
                guard let paidUntil = item.paidUntil, let end = DiscoverySnapshotStore.date(paidUntil), end > now else { return nil }
            }
            // Retain the existing one-day grace period and 14-day unknown-end window.
            if let end = item.endDate, !end.isEmpty {
                guard String(end.prefix(10)) >= dates.day(-1) else { return nil }
            } else {
                guard !item.startDate.isEmpty, String(item.startDate.prefix(10)) >= dates.day(-14) else { return nil }
            }
            let distance = Self.distance(lat, lng, item.lat, item.lng)
            guard distance <= Double(radius) else { return nil }
            var copy = item
            copy.distanceMeters = Int(distance.rounded())
            return copy
        }.sorted {
            if $0.isSponsored != $1.isSponsored { return $0.isSponsored }
            if $0.priorityScore != $1.priorityScore { return $0.priorityScore > $1.priorityScore }
            if $0.distanceMeters != $1.distanceMeters { return $0.distanceMeters < $1.distanceMeters }
            return $0.id < $1.id
        }
    }

    private func candidates<T>(_ grid: [Cell: [T]], lat: Double, lng: Double, radius: Int) -> [T] {
        guard lat.isFinite, lng.isFinite, abs(lat) <= 90, abs(lng) <= 180, radius >= 0 else { return [] }
        // Conservative spherical bounds; exact haversine check below. No undershoot
        // near a cell boundary/pole/dateline can hide an otherwise eligible pin.
        let deltaLat = Double(radius) / 110_000
        let minLat = max(-90, lat - deltaLat)
        let maxLat = min(90, lat + deltaLat)
        let cosExtreme = cos(max(abs(minLat), abs(maxLat)) * .pi / 180)
        let deltaLng = cosExtreme < 0.001 ? 360 : Double(radius) / (110_000 * cosExtreme)
        let allLongitudes = lng - deltaLng < -180 || lng + deltaLng > 180
        let lower = Cell(minLat, max(-180, lng - deltaLng))
        let upper = Cell(maxLat, min(180, lng + deltaLng))
        return grid.filter { cell, _ in
            cell.lat >= lower.lat && cell.lat <= upper.lat &&
                (allLongitudes || (cell.lng >= lower.lng && cell.lng <= upper.lng))
        }.flatMap { $0.value }
    }

    private static func distance(_ lat: Double, _ lng: Double, _ otherLat: Double, _ otherLng: Double) -> Double {
        let r = Double.pi / 180
        let dLat = (otherLat - lat) * r
        let dLng = (otherLng - lng) * r
        let a = pow(sin(dLat / 2), 2) + cos(lat * r) * cos(otherLat * r) * pow(sin(dLng / 2), 2)
        return 6_371_000 * 2 * atan2(sqrt(max(0, a)), sqrt(max(0, 1 - a)))
    }

    private struct Dates {
        let now: Date
        let calendar: Calendar
        let today: String
        init(_ now: Date) {
            self.now = now
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(secondsFromGMT: 9 * 3600)!
            self.calendar = calendar
            self.today = Self.string(now, calendar)
        }
        func day(_ offset: Int) -> String { Self.string(calendar.date(byAdding: .day, value: offset, to: now)!, calendar) }
        func matches(start: String, end: String?, upcoming: Int, past: Int) -> Bool {
            // Unknown dates stay discoverable, matching the existing API semantics.
            guard !start.isEmpty, let end, !end.isEmpty else { return true }
            return String(end.prefix(10)) >= day(-past) && String(start.prefix(10)) <= day(upcoming)
        }
        private static func string(_ date: Date, _ calendar: Calendar) -> String {
            let c = calendar.dateComponents([.year, .month, .day], from: date)
            return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
        }
    }
}
