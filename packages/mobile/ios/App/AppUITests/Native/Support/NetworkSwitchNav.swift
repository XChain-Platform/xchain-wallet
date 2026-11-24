import XCTest

enum NetworkSwitchOutcome: Equatable {
    case switched
    case alreadyActive
    case failed(String)
}

enum NetworkSwitchNav {
    @discardableResult
    static func select(
        _ app: XCUIApplication,
        network: String,
        password: String,
        timeout: TimeInterval = 60
    ) -> NetworkSwitchOutcome {
        let deadline = Date().addingTimeInterval(timeout)
        let settings = button(app, label: "Settings", comparison: "CONTAINS[c]")
        let more = button(app, label: "More", comparison: "CONTAINS[c]")

        guard waitUntil(deadline: deadline, condition: {
            isHittable(settings) || isHittable(more)
        }) else {
            return failed("Settings or More from the home screen", app: app)
        }

        if isHittable(settings) {
            settings.tap()
        } else {
            guard isHittable(more) else {
                return failed("More from the home screen", app: app)
            }
            more.tap()
            guard waitUntilHittable(settings, deadline: deadline) else {
                return failed("Settings in the More sheet", app: app)
            }
            settings.tap()
        }

        let networkAndFees = button(
            app,
            label: "Network and Fees",
            comparison: "BEGINSWITH[c]"
        )
        guard drill(networkAndFees, in: app, deadline: deadline) else {
            return failed("Network and Fees in Settings", app: app)
        }

        let networkRowPredicate = "label BEGINSWITH[c] %@ "
            + "AND NOT (label BEGINSWITH[c] %@) "
            + "AND NOT (label BEGINSWITH[c] %@)"
        let networkRow = app.buttons.matching(
            NSPredicate(
                format: networkRowPredicate,
                "Network",
                "Network and Fees",
                "Network endpoints"
            )
        ).firstMatch
        guard drill(networkRow, in: app, deadline: deadline) else {
            return failed("Network in Network and Fees", app: app)
        }

        let selectionLabel = "Select \(network)"
        let selection = button(
            app,
            label: selectionLabel,
            comparison: "==[c]"
        )
        guard drill(selection, in: app, deadline: deadline) else {
            return failed("\(selectionLabel) in Network", app: app)
        }

        let confirm = button(
            app,
            label: "Switch network",
            comparison: "==[c]"
        )
        let confirmTimeout = boundedTimeout(8, deadline: deadline)
        if !confirm.waitForExistence(timeout: confirmTimeout) {
            guard waitUntil(deadline: deadline, condition: { !selection.exists }) else {
                return failed("Network picker to close for the active network", app: app)
            }
            return .alreadyActive
        }

        guard waitUntilHittable(confirm, deadline: deadline) else {
            return failed("Switch network confirmation", app: app)
        }
        confirm.tap()

        let unlock = button(
            app,
            label: "Unlock Wallet",
            comparison: "==[c]"
        )
        let unlockTimeout = boundedTimeout(10, deadline: deadline)
        if unlock.waitForExistence(timeout: unlockTimeout) {
            let passwordField = app.secureTextFields.firstMatch
            guard waitUntilHittable(passwordField, deadline: deadline) else {
                return failed("Password field after the network switch", app: app)
            }
            passwordField.tap()
            passwordField.typeText(password)
            guard waitUntilHittable(unlock, deadline: deadline) else {
                return failed("Unlock Wallet after the network switch", app: app)
            }
            unlock.tap()
        }

        let home = button(app, label: "Home", comparison: "CONTAINS[c]")
        let balances = button(app, label: "Balances", comparison: "CONTAINS[c]")
        guard waitUntil(deadline: deadline, condition: {
            !unlock.exists && (isHittable(home) || isHittable(balances))
        }) else {
            return failed("Home or Balances after the network switch", app: app)
        }
        return .switched
    }

    private static func button(
        _ app: XCUIApplication,
        label: String,
        comparison: String
    ) -> XCUIElement {
        app.buttons.matching(
            NSPredicate(format: "label \(comparison) %@", label)
        ).firstMatch
    }

    private static func drill(
        _ element: XCUIElement,
        in app: XCUIApplication,
        deadline: Date
    ) -> Bool {
        var swipes = 0
        while !isHittable(element) && swipes < 8 && Date() < deadline {
            app.swipeUp()
            swipes += 1
        }
        guard waitUntilHittable(element, deadline: deadline) else { return false }
        element.tap()
        let settleUntil = min(deadline, Date().addingTimeInterval(1))
        RunLoop.current.run(until: settleUntil)
        return true
    }

    private static func isHittable(_ element: XCUIElement) -> Bool {
        element.exists && element.isHittable && element.isEnabled
    }

    private static func waitUntilHittable(
        _ element: XCUIElement,
        deadline: Date
    ) -> Bool {
        waitUntil(deadline: deadline) { isHittable(element) }
    }

    private static func waitUntil(
        deadline: Date,
        condition: () -> Bool
    ) -> Bool {
        repeat {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        } while Date() < deadline
        return condition()
    }

    private static func boundedTimeout(
        _ timeout: TimeInterval,
        deadline: Date
    ) -> TimeInterval {
        max(0, min(timeout, deadline.timeIntervalSinceNow))
    }

    private static func failed(
        _ step: String,
        app: XCUIApplication
    ) -> NetworkSwitchOutcome {
        XCTContext.runActivity(
            named: "Network switch could not reach: \(step)"
        ) { _ in
            XCTContext.runActivity(named: app.debugDescription) { _ in }
        }
        return .failed(step)
    }
}
