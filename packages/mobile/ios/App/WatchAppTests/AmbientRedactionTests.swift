// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftUI
import XCTest
@testable import WatchApp

@MainActor
final class AmbientRedactionTests: XCTestCase {
    func testVisibleAmountsAndPriceLineStayVisible() {
        let state = redaction()

        XCTAssertEqual(state.amountText("$1,234.56"), "$1,234.56")
        XCTAssertTrue(state.showsPriceLine(noPrice: false, pointCount: 2))
    }

    func testAlwaysOnRedactsAmountsAndPriceLine() {
        assertRedacted(redaction(luminanceReduced: true))
    }

    func testPhoneEyeRedactsAmountsAndPriceLine() {
        assertRedacted(redaction(phoneHidden: true))
    }

    func testHideAmountsRedactsAmountsAndPriceLine() {
        assertRedacted(redaction(hideAmounts: true))
    }

    func testVisiblePriceLineStillNeedsPriceAndTwoPoints() {
        let state = redaction()

        XCTAssertFalse(state.showsPriceLine(noPrice: true, pointCount: 48))
        XCTAssertFalse(state.showsPriceLine(noPrice: false, pointCount: 1))
    }

    func testAmountViewIsPrivacySensitive() {
        let typeName = String(reflecting: type(of: redaction().amount("0.5 BTC")))

        XCTAssertTrue(typeName.contains("PrivacyRedactionViewModifier"), typeName)
    }

    private func redaction(
        luminanceReduced: Bool = false,
        phoneHidden: Bool = false,
        hideAmounts: Bool = false
    ) -> AmbientRedactionState {
        AmbientRedactionState(
            luminanceReduced: luminanceReduced,
            phoneHidden: phoneHidden,
            hideAmounts: hideAmounts
        )
    }

    private func assertRedacted(_ state: AmbientRedactionState) {
        XCTAssertEqual(state.amountText("0.5 BTC"), "••••")
        XCTAssertFalse(state.showsPriceLine(noPrice: false, pointCount: 48))
    }
}
