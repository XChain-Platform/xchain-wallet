// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import XCTest
@testable import WatchApp

@MainActor
final class BalanceRowViewTests: XCTestCase {
    func testIconIsTwentyEightPointsAndPipUsesChain() {
        let bitcoin = makeRow(chainId: "bitcoin-mainnet")
        let ethereum = makeRow(chainId: "ethereum-mainnet")

        XCTAssertEqual(bitcoin.body.icon.size, 28)
        XCTAssertEqual(bitcoin.body.icon.chainId, "bitcoin-mainnet")
        XCTAssertEqual(ethereum.body.icon.chainId, "ethereum-mainnet")
        XCTAssertEqual(bitcoin.body.icon.chainPipHueDegrees, 37)
        XCTAssertEqual(ethereum.body.icon.chainPipHueDegrees, 126)
        XCTAssertNotEqual(
            bitcoin.body.icon.chainPipHueDegrees,
            ethereum.body.icon.chainPipHueDegrees
        )
    }

    func testSmallRowStacksNameOverUnpricedAmount() {
        let row = makeRow(
            fiatMode: true,
            noPrice: true,
            screenWidth: BalanceRowRules.stackBelowWidth - 1
        )

        XCTAssertEqual(row.name, "Bitcoin")
        XCTAssertEqual(row.body.layout, .stacked)
        XCTAssertEqual(row.amountCell.primary, "No price yet")
        XCTAssertEqual(row.amountCell.secondary, "0.5 BTC")
    }

    func testLargeRowPlacesNameAndAmountInline() {
        let row = makeRow(screenWidth: BalanceRowRules.stackBelowWidth)

        XCTAssertEqual(row.name, "Bitcoin")
        XCTAssertEqual(row.body.layout, .inline)
        XCTAssertEqual(row.amountCell.primary, "0.5 BTC")
        XCTAssertNil(row.amountCell.secondary)
    }

    private func makeRow(
        chainId: String = "bitcoin-mainnet",
        fiatMode: Bool = false,
        noPrice: Bool = false,
        screenWidth: Double = BalanceRowRules.stackBelowWidth
    ) -> BalanceRowView {
        BalanceRowView(
            name: "Bitcoin",
            chainId: chainId,
            tick: "BTC",
            tickerColor: "#F7931A",
            amountCell: BalancesLayout.amountCell(
                fiatMode: fiatMode,
                amountText: "0.5 BTC",
                fiatText: noPrice ? "No price yet" : "$32,000.00",
                noPrice: noPrice
            ),
            screenWidth: screenWidth
        )
    }
}
