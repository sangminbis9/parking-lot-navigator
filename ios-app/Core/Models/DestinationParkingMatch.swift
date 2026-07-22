import Foundation

enum DestinationParkingMatch {
    static func isMatch(_ parkingLot: ParkingLot, destination: Destination) -> Bool {
        guard parkingLot.distanceFromDestinationMeters <= 120 else { return false }
        if parkingLot.distanceFromDestinationMeters <= 100 { return true }
        let destinationTokens = tokens(from: destination.name + " " + destination.address)
        let parkingTokens = tokens(from: parkingLot.name + " " + parkingLot.address)
        return !destinationTokens.isDisjoint(with: parkingTokens)
    }

    private static func tokens(from text: String) -> Set<String> {
        let separators = CharacterSet.whitespacesAndNewlines
            .union(.punctuationCharacters)
            .union(.symbols)
        return Set(text
            .lowercased()
            .components(separatedBy: separators)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { $0.count >= 2 && !$0.contains("주차") })
    }
}
