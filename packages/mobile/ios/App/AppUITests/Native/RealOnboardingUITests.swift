import XCTest

final class RealOnboardingUITests: XCTestCase {
    func testCreatesFreshWalletThroughRealOnboarding() {
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

        XCTAssertFalse(app.buttons["Create new wallet"].exists)
        XCTAssertTrue(
            app.buttons["Home"].isHittable || app.buttons["Balances"].isHittable
        )
    }
}
