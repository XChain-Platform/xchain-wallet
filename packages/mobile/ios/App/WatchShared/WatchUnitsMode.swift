import Foundation

enum WatchUnitsMode: String {
    case fiat
    case units

    static func seed(unitDefault: String?) -> WatchUnitsMode {
        unitDefault == WatchUnitsMode.units.rawValue ? .units : .fiat
    }

    static func resolve(
        stored: WatchUnitsMode?,
        unitDefault: String?,
        isTest: Bool
    ) -> WatchUnitsMode {
        if isTest {
            return .units
        }

        return stored ?? seed(unitDefault: unitDefault)
    }

    static func canToggle(isTest: Bool) -> Bool {
        !isTest
    }

    func toggled(isTest: Bool) -> WatchUnitsMode {
        if isTest {
            return .units
        }

        switch self {
        case .fiat:
            return .units
        case .units:
            return .fiat
        }
    }
}
