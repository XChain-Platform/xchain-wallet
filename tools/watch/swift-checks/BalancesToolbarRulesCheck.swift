import Foundation

@main
struct BalancesToolbarRulesCheck {
    static func main() {
        checkControls()
        checkItemDestinations()
        checkUnreadDot()
        checkHeaderTap()
        checkDoubleTapAvailability()
    }

    private static func checkControls() {
        let expected: [(BalancesToolbarRules.Control, WatchScreen)] = [
            (.bell, .alerts),
            (.qr, .receive),
            (.status, .status),
        ]

        check(BalancesToolbarRules.controls.count == expected.count, "control count")
        for (index, pair) in expected.enumerated() {
            let control = BalancesToolbarRules.controls[index]
            check(control == pair.0, "control order at index \(index)")
            check(
                BalancesToolbarRules.destination(control) == pair.1,
                "control destination at index \(index)"
            )
            check(
                WatchScreenGraph.canPush(pair.1, from: .balances),
                "control destination is pushable at index \(index)"
            )
        }
    }

    private static func checkItemDestinations() {
        let expected: [(BalancesLayout.Item, WatchScreen?)] = [
            (.row(0), .tokenDetail),
            (.row(49), .tokenDetail),
            (.request, .alertDetail),
            (.moreOnPhone, nil),
            (.empty, nil),
        ]

        for (item, screen) in expected {
            let destination = BalancesToolbarRules.destination(item)
            check(destination == screen, "item destination for \(item)")
            if let destination {
                check(
                    WatchScreenGraph.canPush(destination, from: .balances),
                    "item destination is pushable for \(item)"
                )
            }
        }
    }

    private static func checkUnreadDot() {
        check(!BalancesToolbarRules.showsUnreadDot(unread: -1), "negative unread count")
        check(!BalancesToolbarRules.showsUnreadDot(unread: 0), "zero unread count")
        check(BalancesToolbarRules.showsUnreadDot(unread: 1), "one unread item")
        check(BalancesToolbarRules.showsUnreadDot(unread: 2), "multiple unread items")
    }

    private static func checkHeaderTap() {
        check(
            BalancesToolbarRules.headerTap(mode: .fiat, isTest: false) == .units,
            "fiat header tap"
        )
        check(
            BalancesToolbarRules.headerTap(mode: .units, isTest: false) == .fiat,
            "units header tap"
        )
        check(
            BalancesToolbarRules.headerTap(mode: .fiat, isTest: true) == nil,
            "test network fiat header tap"
        )
        check(
            BalancesToolbarRules.headerTap(mode: .units, isTest: true) == nil,
            "test network units header tap"
        )
    }

    private static func checkDoubleTapAvailability() {
        check(!BalancesToolbarRules.doubleTapAvailable(osMajor: 10), "watchOS 10 double tap")
        check(BalancesToolbarRules.doubleTapAvailable(osMajor: 11), "watchOS 11 double tap")
        check(BalancesToolbarRules.doubleTapAvailable(osMajor: 12), "watchOS 12 double tap")
    }

    private static func check(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else {
            FileHandle.standardError.write(Data("FAIL: \(name)\n".utf8))
            exit(1)
        }
    }
}
