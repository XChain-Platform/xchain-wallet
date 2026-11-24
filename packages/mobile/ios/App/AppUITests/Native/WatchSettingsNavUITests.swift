import XCTest

final class WatchSettingsNavUITests: XCTestCase {
    func testOpensWatchSettingsAfterCreatingFreshWallet() {
        executionTimeAllowance = 600

        let app = XCUIApplication()
        app.launch()

        let words = RealOnboarding.createFreshWallet(
            app,
            password: "WalletPass1!"
        )
        XCTAssertNotNil(words)
        guard words != nil else { return }

        XCTAssertTrue(WatchSettingsNav.open(app))
        XCTAssertTrue(button(app, named: "Send Test Alert").exists)
        XCTAssertFalse(button(app, named: "Create new wallet").exists)
    }

    private func button(_ app: XCUIApplication, named label: String) -> XCUIElement {
        app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] %@", label)
        ).firstMatch
    }
}
