import Foundation

@main
struct WatchUnitsModeCheck {
    static func main() {
        check("seed units", WatchUnitsMode.seed(unitDefault: "units") == .units)
        check("seed fiat", WatchUnitsMode.seed(unitDefault: "fiat") == .fiat)
        check("seed nil", WatchUnitsMode.seed(unitDefault: nil) == .fiat)
        check("seed empty", WatchUnitsMode.seed(unitDefault: "") == .fiat)
        check("seed Units", WatchUnitsMode.seed(unitDefault: "Units") == .fiat)
        check(
            "stored choice wins",
            WatchUnitsMode.resolve(
                stored: .units,
                unitDefault: "fiat",
                isTest: false
            ) == .units
        )
        check(
            "test network overrides stored fiat",
            WatchUnitsMode.resolve(
                stored: .fiat,
                unitDefault: "fiat",
                isTest: true
            ) == .units
        )
        check(
            "test network overrides fiat seed",
            WatchUnitsMode.resolve(
                stored: nil,
                unitDefault: "fiat",
                isTest: true
            ) == .units
        )
        check("toggle allowed off test network", WatchUnitsMode.canToggle(isTest: false))
        check("toggle disabled on test network", !WatchUnitsMode.canToggle(isTest: true))

        let start = WatchUnitsMode.fiat
        check(
            "toggle twice returns start",
            start.toggled(isTest: false).toggled(isTest: false) == start
        )
        check(
            "test network toggle stays units",
            WatchUnitsMode.fiat.toggled(isTest: true) == .units
        )
    }

    private static func check(_ name: String, _ passed: @autoclosure () -> Bool) {
        guard passed() else {
            FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
            exit(1)
        }
    }
}
