import Foundation

final class WatchPrefs {
    static let appGroup = "group.io.xchain.wallet.ios.watch"

    private enum Key {
        static let unitsMode = "units_mode"
        static let hideAmounts = "hide_amounts"
    }

    private let defaults: UserDefaults

    init(defaults: UserDefaults? = UserDefaults(suiteName: appGroup)) {
        precondition(defaults != nil, "Watch app group is unavailable")
        self.defaults = defaults!
    }

    func unitsMode(unitDefault: String?, isTest: Bool) -> WatchUnitsMode {
        WatchUnitsMode.resolve(
            stored: defaults.string(forKey: Key.unitsMode).flatMap(WatchUnitsMode.init(rawValue:)),
            unitDefault: unitDefault,
            isTest: isTest
        )
    }

    @discardableResult
    func toggleUnits(unitDefault: String?, isTest: Bool) -> WatchUnitsMode {
        let mode = unitsMode(unitDefault: unitDefault, isTest: isTest).toggled(isTest: isTest)
        if WatchUnitsMode.canToggle(isTest: isTest) {
            defaults.set(mode.rawValue, forKey: Key.unitsMode)
        }
        return mode
    }

    var hideAmounts: Bool {
        get { defaults.bool(forKey: Key.hideAmounts) }
        set { defaults.set(newValue, forKey: Key.hideAmounts) }
    }
}
