// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftUI
import XCTest
@testable import WatchApp

@MainActor
final class WatchRenderTests: XCTestCase {
    func testScreenSizeHasPositiveDimensions() {
        let size = WatchRender.screenSize()

        XCTAssertGreaterThan(size.width, 0)
        XCTAssertGreaterThan(size.height, 0)
    }

    func testNotSetUpScreenRendersNonblankImage() throws {
        let image = try XCTUnwrap(WatchRender.image(
            NotSetUpScreen(textKey: "state.openWalletOnPhone"),
            size: WatchRender.screenSize()
        ))

        XCTAssertFalse(WatchRender.isBlank(image))
    }

    func testClearColorRendersBlankImage() throws {
        let image = try XCTUnwrap(WatchRender.image(
            Color.clear,
            size: WatchRender.screenSize()
        ))

        XCTAssertTrue(WatchRender.isBlank(image))
    }

    func testFitsRejectsTextWiderThanScreen() {
        let width = WatchRender.screenSize().width

        XCTAssertTrue(WatchRender.fits(
            "0.5 BTC",
            font: .body,
            dynamicTypeSize: .large,
            width: width
        ))
        XCTAssertFalse(WatchRender.fits(
            Array(repeating: "0.5 BTC", count: 30).joined(separator: " "),
            font: .body,
            dynamicTypeSize: .large,
            width: width
        ))
    }

    func testAccessibilityTextIsWider() throws {
        let large = try XCTUnwrap(WatchRender.idealWidth(
            of: "0.5 BTC",
            font: .body,
            dynamicTypeSize: .large
        ))
        let accessibility = try XCTUnwrap(WatchRender.idealWidth(
            of: "0.5 BTC",
            font: .body,
            dynamicTypeSize: .accessibility3
        ))

        XCTAssertGreaterThan(accessibility, large)
    }

    func testBalanceRowStringsIncludeNameAndAmount() {
        let row = BalanceRowView(
            name: "Bitcoin",
            chainId: "bitcoin-mainnet",
            tick: "BTC",
            tickerColor: "#F7931A",
            amountCell: BalancesLayout.amountCell(
                fiatMode: false,
                amountText: "0.5 BTC",
                fiatText: "$32,000.00",
                noPrice: false
            ),
            screenWidth: Double(WatchRender.screenSize().width)
        )
        let strings = WatchRender.strings(in: row)

        XCTAssertTrue(strings.contains("Bitcoin"))
        XCTAssertTrue(strings.contains("0.5 BTC"))
    }
}
