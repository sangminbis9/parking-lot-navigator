import Foundation

struct ParkingRecommendation: Identifiable, Hashable {
    let parkingLot: ParkingLot
    let score: Double
    let reasons: [String]
    let badges: [String]

    var id: String { parkingLot.id }

    var scorePercent: Int {
        Int((score * 100).rounded())
    }

    var primaryReason: String {
        reasons.first ?? "균형 잡힌 선택"
    }
}

struct ParkingRecommendationEngine {
    var now = Date()
    var calendar = Calendar.current

    func recommendations(for parkingLots: [ParkingLot], destination: Destination) -> [ParkingRecommendation] {
        parkingLots
            .map { recommendation(for: $0, destination: destination) }
            .sorted { lhs, rhs in
                let lhsDestinationParking = isDestinationParking(lhs.parkingLot, for: destination)
                let rhsDestinationParking = isDestinationParking(rhs.parkingLot, for: destination)
                if lhsDestinationParking != rhsDestinationParking {
                    return lhsDestinationParking
                }
                if lhs.score != rhs.score {
                    return lhs.score > rhs.score
                }
                return lhs.parkingLot.distanceFromDestinationMeters < rhs.parkingLot.distanceFromDestinationMeters
            }
    }

    func recommendation(for parkingLot: ParkingLot, destination: Destination) -> ParkingRecommendation {
        let components = ScoreComponents(
            walking: walkingScore(parkingLot),
            vacancy: vacancyScore(parkingLot),
            fee: feeScore(parkingLot),
            operating: operatingScore(parkingLot),
            exit: exitConvenienceScore(parkingLot),
            trust: trustScore(parkingLot),
            pattern: congestionPatternScore(parkingLot)
        )
        let score = clamp(
            components.walking * 0.20 +
                components.vacancy * 0.24 +
                components.fee * 0.14 +
                components.operating * 0.12 +
                components.exit * 0.12 +
                components.trust * 0.10 +
                components.pattern * 0.08
        )

        return ParkingRecommendation(
            parkingLot: parkingLot,
            score: score,
            reasons: reasons(for: parkingLot, destination: destination, components: components),
            badges: badges(for: parkingLot, components: components)
        )
    }

    private func walkingScore(_ parkingLot: ParkingLot) -> Double {
        let distance = Double(parkingLot.distanceFromDestinationMeters)
        if distance <= 120 { return 1 }
        if distance >= 800 { return 0.12 }
        return clamp(1 - ((distance - 120) / 680))
    }

    private func vacancyScore(_ parkingLot: ParkingLot) -> Double {
        var score: Double
        if let occupancyRate = parkingLot.occupancyRate {
            score = 1 - clamp(occupancyRate)
        } else if let availableSpaces = parkingLot.availableSpaces, let totalCapacity = parkingLot.totalCapacity, totalCapacity > 0 {
            score = clamp(Double(availableSpaces) / Double(totalCapacity))
        } else {
            score = 0.42
        }

        switch parkingLot.congestionStatus {
        case .available:
            score = max(score, 0.82)
        case .moderate:
            score = max(score, 0.56)
        case .busy:
            score = min(score, 0.35)
        case .full:
            score = min(score, 0.06)
        case .unknown:
            score = min(score, 0.48)
        }

        if let availableSpaces = parkingLot.availableSpaces {
            if availableSpaces >= 30 {
                score += 0.12
            } else if availableSpaces <= 3 {
                score -= 0.16
            }
        }

        return clamp(score)
    }

    private func feeScore(_ parkingLot: ParkingLot) -> Double {
        guard let feeSummary = parkingLot.feeSummary else { return 0.55 }
        guard let hourlyFee = estimatedHourlyFee(from: feeSummary) else { return 0.55 }
        if hourlyFee <= 1_000 { return 1 }
        if hourlyFee <= 2_000 { return 0.82 }
        if hourlyFee <= 4_000 { return 0.58 }
        if hourlyFee <= 6_000 { return 0.38 }
        return 0.22
    }

    private func operatingScore(_ parkingLot: ParkingLot) -> Double {
        guard let operatingHours = parkingLot.operatingHours, !operatingHours.isEmpty else { return 0.62 }
        if operatingHours.contains("24") { return 1 }

        let ranges = timeRanges(in: operatingHours)
        guard !ranges.isEmpty else { return 0.62 }

        let currentMinute = minuteOfDay(now)
        for range in ranges {
            if contains(currentMinute, in: range) {
                let minutesUntilClose = minutesUntilClose(from: currentMinute, in: range)
                return minutesUntilClose <= 60 ? 0.55 : 0.92
            }
        }
        return 0.08
    }

    private func exitConvenienceScore(_ parkingLot: ParkingLot) -> Double {
        var score = parkingLot.isPublic ? 0.72 : 0.58
        if let totalCapacity = parkingLot.totalCapacity {
            if totalCapacity >= 150 {
                score += 0.14
            } else if totalCapacity < 40 {
                score -= 0.10
            }
        }
        if parkingLot.congestionStatus == .busy || parkingLot.congestionStatus == .full {
            score -= 0.18
        }
        if parkingLot.availableSpaces == nil && parkingLot.occupancyRate == nil {
            score -= 0.08
        }
        return clamp(score)
    }

    private func trustScore(_ parkingLot: ParkingLot) -> Double {
        var score = parkingLot.realtimeAvailable ? 0.82 : 0.48
        if parkingLot.stale {
            score -= 0.28
        }
        if parkingLot.freshnessTimestamp != nil {
            score += 0.08
        }
        if !parkingLot.provenance.isEmpty {
            score += min(Double(parkingLot.provenance.count) * 0.04, 0.12)
        }
        score += clamp(parkingLot.score) * 0.12
        return clamp(score)
    }

    private func congestionPatternScore(_ parkingLot: ParkingLot) -> Double {
        let hour = calendar.component(.hour, from: now)
        let isWeekend = calendar.isDateInWeekend(now)
        var score = 0.62

        if isWeekend && (11...18).contains(hour) {
            score -= parkingLot.isPublic ? 0.08 : 0.16
        } else if !isWeekend && (8...10).contains(hour) {
            score -= parkingLot.isPublic ? 0.10 : 0.18
        } else if !isWeekend && (18...20).contains(hour) {
            score -= parkingLot.isPublic ? 0.12 : 0.20
        } else {
            score += 0.08
        }

        if parkingLot.congestionStatus == .available {
            score += 0.16
        } else if parkingLot.congestionStatus == .busy || parkingLot.congestionStatus == .full {
            score -= 0.16
        }

        return clamp(score)
    }

    private func reasons(for parkingLot: ParkingLot, destination: Destination, components: ScoreComponents) -> [String] {
        var reasons: [String] = []

        if isDestinationParking(parkingLot, for: destination) {
            reasons.append("도착지 바로 옆")
        } else if parkingLot.distanceFromDestinationMeters <= 250 {
            reasons.append("도착 후 걷기 편함")
        }
        if components.vacancy >= 0.78 {
            reasons.append("가장 널널함")
        } else if components.vacancy <= 0.25 {
            reasons.append("만차 가능성 주의")
        }
        if components.fee >= 0.82 {
            reasons.append("가장 저렴함")
        }
        if components.exit >= 0.74 {
            reasons.append("빠른 출차에 유리함")
        }
        if components.trust >= 0.78 {
            reasons.append("실시간 정보 신뢰도 높음")
        } else if parkingLot.stale {
            reasons.append("정보 지연 가능")
        }
        if components.operating <= 0.20 {
            reasons.append("운영시간 확인 필요")
        } else if components.operating >= 0.92 {
            reasons.append("운영시간 안정적")
        }
        if components.pattern >= 0.74 {
            reasons.append("현재 시간대 혼잡 부담 낮음")
        }

        return Array(reasons.prefix(4))
    }

    private func badges(for parkingLot: ParkingLot, components: ScoreComponents) -> [String] {
        var badges: [String] = []
        if parkingLot.distanceFromDestinationMeters <= 250 {
            badges.append("가까움")
        }
        if components.fee >= 0.82 {
            badges.append("저렴")
        }
        if components.vacancy >= 0.78 {
            badges.append("널널")
        }
        if components.exit >= 0.74 {
            badges.append("출차")
        }
        if components.trust >= 0.78 {
            badges.append("신뢰")
        }
        return badges
    }

    private func isDestinationParking(_ parkingLot: ParkingLot, for destination: Destination) -> Bool {
        guard parkingLot.distanceFromDestinationMeters <= 120 else { return false }
        if parkingLot.distanceFromDestinationMeters <= 100 { return true }
        let destinationTokens = tokens(from: destination.name + " " + destination.address)
        let parkingTokens = tokens(from: parkingLot.name + " " + parkingLot.address)
        return !destinationTokens.isDisjoint(with: parkingTokens)
    }

    private func tokens(from text: String) -> Set<String> {
        let separators = CharacterSet.whitespacesAndNewlines
            .union(.punctuationCharacters)
            .union(.symbols)
        return Set(text
            .lowercased()
            .components(separatedBy: separators)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { $0.count >= 2 && !$0.contains("주차") })
    }

    private func estimatedHourlyFee(from text: String) -> Int? {
        let numbers = text
            .split { !$0.isNumber && $0 != "," }
            .compactMap { Int(String($0).replacingOccurrences(of: ",", with: "")) }
        guard let fee = numbers.last else { return nil }

        if text.contains("10") {
            return fee * 6
        }
        if text.contains("30") {
            return fee * 2
        }
        return fee
    }

    private func timeRanges(in text: String) -> [TimeRange] {
        let pattern = #"(\d{1,2}):(\d{2})\s*[-~]\s*(\d{1,2}):(\d{2})"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        let nsRange = NSRange(text.startIndex..<text.endIndex, in: text)
        return regex.matches(in: text, range: nsRange).compactMap { match in
            guard match.numberOfRanges == 5,
                  let startHour = value(at: 1, in: match, text: text),
                  let startMinute = value(at: 2, in: match, text: text),
                  let endHour = value(at: 3, in: match, text: text),
                  let endMinute = value(at: 4, in: match, text: text) else {
                return nil
            }
            return TimeRange(
                start: startHour * 60 + startMinute,
                end: endHour * 60 + endMinute
            )
        }
    }

    private func value(at index: Int, in match: NSTextCheckingResult, text: String) -> Int? {
        guard let range = Range(match.range(at: index), in: text) else { return nil }
        return Int(String(text[range]))
    }

    private func minuteOfDay(_ date: Date) -> Int {
        calendar.component(.hour, from: date) * 60 + calendar.component(.minute, from: date)
    }

    private func contains(_ minute: Int, in range: TimeRange) -> Bool {
        if range.start <= range.end {
            return (range.start...range.end).contains(minute)
        }
        return minute >= range.start || minute <= range.end
    }

    private func minutesUntilClose(from minute: Int, in range: TimeRange) -> Int {
        if range.start <= range.end {
            return range.end - minute
        }
        if minute >= range.start {
            return (24 * 60 - minute) + range.end
        }
        return range.end - minute
    }

    private func clamp(_ value: Double) -> Double {
        min(max(value, 0), 1)
    }
}

private struct ScoreComponents {
    let walking: Double
    let vacancy: Double
    let fee: Double
    let operating: Double
    let exit: Double
    let trust: Double
    let pattern: Double
}

private struct TimeRange {
    let start: Int
    let end: Int
}
