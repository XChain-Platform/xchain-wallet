import XCTest

final class NetworkSwitchNavUITests: XCTestCase {
    func testSelectsTestnetForFreshWallet() {
        executionTimeAllowance = 600

        let app = XCUIApplication()
        app.launch()

        let password = "XChainPwd1!?"
        let words = RealOnboarding.createFreshWallet(
            app,
            password: password
        )
        XCTAssertNotNil(words)
        guard words != nil else { return }

        let firstSelection = NetworkSwitchNav.select(
            app,
            network: "Testnet",
            password: password
        )
        XCTAssertTrue(
            firstSelection == .switched || firstSelection == .alreadyActive,
            "The first Testnet selection must switch or confirm it is already active"
        )

        let secondSelection = NetworkSwitchNav.select(
            app,
            network: "Testnet",
            password: password
        )
        XCTAssertEqual(secondSelection, .alreadyActive)
    }
}
