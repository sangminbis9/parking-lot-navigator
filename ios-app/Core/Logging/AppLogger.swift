import Foundation
import os

enum AppLogger {
    static let app = Logger(subsystem: "ParkingLotNavigator", category: "app")
    static let networking = Logger(subsystem: "ParkingLotNavigator", category: "networking")
    static let navigation = Logger(subsystem: "ParkingLotNavigator", category: "navigation")
}
