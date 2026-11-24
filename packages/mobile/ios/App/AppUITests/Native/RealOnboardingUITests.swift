import XCTest

final class RealOnboardingUITests: XCTestCase {
    func testCreatesFreshWalletThroughRealOnboarding() {
        executionTimeAllowance = 600

        let app = XCUIApplication()
        app.launch()

        let words = RealOnboarding.createFreshWallet(
            app,
            password: "WalletPass1!"
        )

        XCTAssertNotNil(words)
        guard let words else { return }
        XCTAssertEqual(words.count, 12)
        for word in words {
            XCTAssertFalse(word.isEmpty)
            XCTAssertTrue(
                word.unicodeScalars.allSatisfy { (97...122).contains(Int($0.value)) },
                "Recovery phrase entries must contain lowercase ASCII letters only"
            )
        }

        XCTAssertFalse(button(app, named: "Create new wallet").exists)
        XCTAssertTrue(
            button(app, named: "Home").isHittable
                || button(app, named: "Balances").isHittable
        )
    }

    private func button(_ app: XCUIApplication, named label: String) -> XCUIElement {
        app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] %@", label)
        ).firstMatch
    }
}
