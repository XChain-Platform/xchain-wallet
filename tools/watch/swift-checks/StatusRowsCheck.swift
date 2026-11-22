import Darwin
import Foundation

@main
struct StatusRowsCheck {
    static func main() {
        let unlocked = StatusRows.rows(
            reachable: true,
            balancesAt: 1_700_000_000,
            session: "unlocked",
            hideAmounts: false,
            appVersion: "1.2.3"
        )
        require(
            unlocked == [
                .init(labelKey: "state.phoneReachable", value: .flag(true)),
                .init(labelKey: "state.lastSync", value: .age(balancesAt: 1_700_000_000)),
                .init(labelKey: "state.session", value: .session(locked: false)),
                .init(labelKey: "state.hideAmounts", value: .toggle(false)),
                .init(labelKey: "state.version", value: .text("1.2.3")),
            ],
            "reachable and unlocked"
        )

        let locked = StatusRows.rows(
            reachable: true,
            balancesAt: 123,
            session: "locked",
            hideAmounts: true,
            appVersion: "2.0"
        )
        require(locked[2].value == .session(locked: true), "reachable and locked")

        let unreachable = StatusRows.rows(
            reachable: false,
            balancesAt: 123,
            session: "locked",
            hideAmounts: false,
            appVersion: "2.0"
        )
        require(
            unreachable[2].value == .sessionUnknown,
            "unreachable with stored locked session"
        )

        for invalidSession in [nil, "", "Unlocked"] as [String?] {
            let rows = StatusRows.rows(
                reachable: true,
                balancesAt: 123,
                session: invalidSession,
                hideAmounts: false,
                appVersion: "2.0"
            )
            require(
                rows[2].value == .sessionUnknown,
                "reachable with invalid session \(String(describing: invalidSession))"
            )
        }

        let noSnapshot = StatusRows.rows(
            reachable: true,
            balancesAt: nil,
            session: "unlocked",
            hideAmounts: false,
            appVersion: "2.0"
        )
        require(noSnapshot[1].value == .none, "no balancesAt")

        let expectedLabels = [
            "state.phoneReachable",
            "state.lastSync",
            "state.session",
            "state.hideAmounts",
            "state.version",
        ]
        require(StatusRows.titleKey == "state.status", "titleKey")
        require(unlocked.map(\.labelKey) == expectedLabels, "five labels in order")

        let valueKeys: [(StatusRows.Value, String?)] = [
            (.flag(true), nil),
            (.age(balancesAt: 123), nil),
            (.none, nil),
            (.session(locked: true), nil),
            (.sessionUnknown, "state.sessionUnknown"),
            (.toggle(false), nil),
            (.text("1.2.3"), nil),
        ]
        for (value, expectedKey) in valueKeys {
            require(
                StatusRows.valueKey(value) == expectedKey,
                "valueKey for \(String(describing: value))"
            )
        }

        let stringsPath = "packages/core/src/watch/contract/strings-balances.json"
        let strings: [String: Any]
        do {
            let data = try Data(contentsOf: URL(fileURLWithPath: stringsPath))
            guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                fail("strings contract is not an object")
            }
            strings = object
        } catch {
            fail("read strings contract: \(error)")
        }

        for key in [StatusRows.titleKey] + expectedLabels + ["state.sessionUnknown"] {
            require(strings[key] != nil, "strings contract key \(key)")
        }
    }

    private static func require(_ condition: @autoclosure () -> Bool, _ name: String) {
        if !condition() {
            fail(name)
        }
    }

    private static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
        exit(1)
    }
}
