import XCTest

final class WatchPairE2ETests: XCTestCase {
    func testFreshTestnetWalletReachesWatchSettings() {
        executionTimeAllowance = 600
        let app = XCUIApplication()
        let password = "WatchPair1!?"
        app.launch()
        revealInitialAction(app)

        let words = RealOnboarding.createFreshWallet(
            app,
            password: password,
            timeout: 180
        )
        XCTAssertEqual(words?.count, 12)
        guard words != nil else { return }
        XCTAssertTrue(selectTestnet(app, password: password))
        XCTAssertTrue(WatchSettingsNav.open(app, timeout: 60))
        guard let lastSyncBefore = lastSyncValue(app, timeout: 30) else {
            XCTFail("Watch pair test could not read Last sync before enabling watch sharing")
            return
        }
        XCTAssertTrue(enableWatch(app, timeout: 30))
        XCTAssertTrue(waitForSnapshotSent(
            app,
            previousLastSync: lastSyncBefore,
            timeout: 60
        ))
    }

    private func revealInitialAction(_ app: XCUIApplication) {
        let ready = app.buttons.matching(NSPredicate(
            format: "label CONTAINS[c] 'Create new wallet' OR label CONTAINS[c] 'Next' OR label CONTAINS[c] 'Get started' OR label CONTAINS[c] 'Accept and continue'"
        )).firstMatch
        guard app.staticTexts.firstMatch.waitForExistence(timeout: 30) else { return }
        for _ in 0..<25 where !ready.exists {
            app.swipeUp(velocity: .fast)
        }
    }

    private func selectTestnet(_ app: XCUIApplication, password: String) -> Bool {
        guard openSettings(app) else { return failed("Settings", app) }
        guard drill(app, label: "Network and Fees") else {
            return failed("Network and Fees", app)
        }
        let network = app.buttons.matching(NSPredicate(
            format: "label BEGINSWITH[c] 'Network' AND NOT label BEGINSWITH[c] 'Network and Fees' AND NOT label BEGINSWITH[c] 'Network endpoints'"
        )).firstMatch
        guard tapAfterScrolling(network, in: app) else { return failed("Network", app) }
        let testnet = app.buttons.matching(
            NSPredicate(format: "label ==[c] 'Select Testnet'")
        ).firstMatch
        guard tapAfterScrolling(testnet, in: app) else {
            return failed("Select Testnet", app)
        }

        let confirm = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] 'Switch network'")
        ).firstMatch
        if confirm.waitForExistence(timeout: 8) {
            confirm.tap()
        } else if testnet.exists {
            return failed("Testnet confirmation", app)
        }

        let unlock = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] 'Unlock Wallet'")
        ).firstMatch
        if unlock.waitForExistence(timeout: 15) {
            let passwordField = app.secureTextFields.firstMatch
            guard passwordField.waitForExistence(timeout: 10) else {
                return failed("unlock password", app)
            }
            passwordField.tap()
            passwordField.typeText(password)
            unlock.tap()
        }
        return waitForHome(app, timeout: 60)
    }

    private func openSettings(_ app: XCUIApplication) -> Bool {
        let settings = button(app, containing: "Settings")
        if settings.exists && settings.isHittable { settings.tap(); return true }
        let more = button(app, containing: "More")
        guard more.waitForExistence(timeout: 20), more.isHittable else { return false }
        more.tap()
        guard settings.waitForExistence(timeout: 20), settings.isHittable else { return false }
        settings.tap()
        return true
    }

    private func drill(_ app: XCUIApplication, label: String) -> Bool {
        tapAfterScrolling(app.buttons.matching(
            NSPredicate(format: "label BEGINSWITH[c] %@", label)
        ).firstMatch, in: app)
    }

    private func tapAfterScrolling(_ element: XCUIElement, in app: XCUIApplication) -> Bool {
        for _ in 0..<9 {
            if element.exists && element.isHittable { element.tap(); return true }
            app.swipeUp()
        }
        return false
    }

    private func waitForHome(_ app: XCUIApplication, timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        let home = button(app, containing: "Home")
        let balances = button(app, containing: "Balances")
        repeat {
            if home.exists && home.isHittable { home.tap(); return true }
            if balances.exists && balances.isHittable { balances.tap(); return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        } while Date() < deadline
        return failed("Home after Testnet switch", app)
    }

    private func button(_ app: XCUIApplication, containing label: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", label)).firstMatch
    }

    private func enableWatch(
        _ app: XCUIApplication,
        timeout: TimeInterval
    ) -> Bool {
        let toggle = app.switches.matching(NSPredicate(
            format: "label CONTAINS[c] 'Show wallet on watch'"
        )).firstMatch
        guard toggle.waitForExistence(timeout: timeout) else {
            return failed("Show wallet on watch toggle", app)
        }
        if !toggleIsOn(toggle) {
            guard tapAfterScrolling(toggle, in: app) else {
                return failed("enable Show wallet on watch", app)
            }
        }
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if toggleIsOn(toggle) { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        } while Date() < deadline
        return failed("Show wallet on watch toggle on", app)
    }

    private func toggleIsOn(_ toggle: XCUIElement) -> Bool {
        if let value = toggle.value as? String {
            return value == "1" || value.lowercased() == "on"
        }
        if let value = toggle.value as? NSNumber { return value.boolValue }
        return toggle.isSelected
    }

    private func waitForSnapshotSent(
        _ app: XCUIApplication,
        previousLastSync: String,
        timeout: TimeInterval
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        let sendTestAlert = app.buttons.matching(NSPredicate(
            format: "label CONTAINS[c] 'Send Test Alert'"
        )).firstMatch
        guard tapAfterScrolling(sendTestAlert, in: app) else {
            return failed("Send Test Alert", app)
        }
        var currentLastSync: String?
        repeat {
            currentLastSync = lastSyncValue(app, timeout: 1)
            if let currentLastSync,
               currentLastSync != previousLastSync,
               isFreshLastSync(currentLastSync) {
                return true
            }
            guard reloadWatchSettings(app, deadline: deadline) else { break }
        } while Date() < deadline
        return failed(
            "sent watch snapshot; Last sync before '\(previousLastSync)', after '\(currentLastSync ?? "missing")'",
            app
        )
    }

    private func lastSyncValue(
        _ app: XCUIApplication,
        timeout: TimeInterval
    ) -> String? {
        let title = app.staticTexts.matching(NSPredicate(
            format: "label ==[c] 'Last sync'"
        )).firstMatch
        guard title.waitForExistence(timeout: timeout) else { return nil }
        let titleFrame = title.frame
        return app.staticTexts.allElementsBoundByIndex
            .filter {
                $0.exists
                    && $0.label.caseInsensitiveCompare("Last sync") != .orderedSame
                    && $0.frame.minX >= titleFrame.maxX
                    && abs($0.frame.midY - titleFrame.midY)
                        <= max(titleFrame.height, $0.frame.height)
            }
            .sorted { $0.frame.minX < $1.frame.minX }
            .first?.label
    }

    private func isFreshLastSync(_ value: String) -> Bool {
        let normalized = value.lowercased()
        if normalized == "just now" { return true }
        return normalized.range(
            of: #"^[0-9]+ seconds? ago$"#,
            options: .regularExpression
        ) != nil
    }

    private func reloadWatchSettings(
        _ app: XCUIApplication,
        deadline: Date
    ) -> Bool {
        let back = app.buttons.matching(NSPredicate(
            format: "label CONTAINS[c] 'Back to settings'"
        )).firstMatch
        guard waitUntilHittable(back, deadline: deadline) else { return false }
        back.tap()

        let watch = app.buttons.matching(NSPredicate(
            format: "label BEGINSWITH[c] 'Watch'"
        )).firstMatch
        guard tapAfterScrolling(watch, in: app) else { return false }
        let lastSyncTitle = app.staticTexts.matching(NSPredicate(
            format: "label ==[c] 'Last sync'"
        )).firstMatch
        return lastSyncTitle.waitForExistence(
            timeout: min(5, max(0, deadline.timeIntervalSinceNow))
        )
    }

    private func waitUntilHittable(
        _ element: XCUIElement,
        deadline: Date
    ) -> Bool {
        repeat {
            if element.exists && element.isHittable { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        } while Date() < deadline
        return element.exists && element.isHittable
    }

    private func failed(_ step: String, _ app: XCUIApplication) -> Bool {
        XCTContext.runActivity(named: "Watch pair test could not reach: \(step)") { _ in
            XCTContext.runActivity(named: app.debugDescription) { _ in }
        }
        return false
    }
}
