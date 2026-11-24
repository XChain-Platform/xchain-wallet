// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation
import SwiftUI
import XCTest
@testable import WatchApp

@MainActor
final class TokenDetailFactsViewTests: XCTestCase {
    func testCachedDetailBuildsOrderedFactsWithoutNotice() throws {
        let view = TokenDetailFactsView(display: try display(detail: "detail-cached"))

        XCTAssertEqual(view.entries, [
            TokenDetailFactsEntry(
                label: "w2.change24h",
                labelIsKey: true,
                value: "+4.75% over 24 h"
            ),
            TokenDetailFactsEntry(
                label: "w2.priceSource",
                labelIsKey: true,
                value: "XChain DEX"
            ),
            TokenDetailFactsEntry(label: "Type", labelIsKey: false, value: "Token"),
            TokenDetailFactsEntry(label: "Supply", labelIsKey: false, value: "1,000,000 XC"),
            TokenDetailFactsEntry(label: "Divisibility", labelIsKey: false, value: "6 decimals"),
            TokenDetailFactsEntry(label: "Status", labelIsKey: false, value: "Mutable"),
            TokenDetailFactsEntry(label: "Creator", labelIsKey: false, value: "xc1qab...7pq999"),
            TokenDetailFactsEntry(
                label: "w2.description",
                labelIsKey: true,
                value: "A cached token used to verify that watch detail screens render "
                    + "phone-formatted facts and descriptions."
            ),
        ])
        XCTAssertNil(view.noticeKey)
    }

    func testLoadErrorWithReachablePhoneShowsUnavailableNotice() throws {
        let view = TokenDetailFactsView(display: try display(detail: "detail-loaderror"))

        XCTAssertTrue(view.entries.isEmpty)
        XCTAssertEqual(view.noticeKey, "w2.detailsUnavailable")
    }

    func testMissingDetailWithPhoneAwayShowsMoreDetailsNotice() {
        let view = TokenDetailFactsView(display: TokenDetailPresenter.present(
            row: row(),
            detail: nil,
            phoneReachable: false
        ))

        XCTAssertTrue(view.entries.isEmpty)
        XCTAssertEqual(view.noticeKey, "w2.moreDetails")
    }

    func testCachedDetailRendersAtWatchSize() throws {
        let renderer = ImageRenderer(
            content: TokenDetailFactsView(display: try display(detail: "detail-cached"))
                .frame(width: 176, height: 215)
        )

        XCTAssertNotNil(renderer.cgImage)
    }

    private func display(
        detail name: String,
        phoneReachable: Bool = true
    ) throws -> TokenDetailDisplay {
        let directory = try XCTUnwrap(WatchFixtureFiles.directory())
        let detail = try JSONDecoder().decode(
            Detail.self,
            from: WatchFixtureFiles.data(name, in: directory)
        )
        return TokenDetailPresenter.present(
            row: row(id: detail.tokenId),
            detail: detail,
            phoneReachable: phoneReachable
        )
    }

    private func row(id: String = "bitcoin-mainnet:XC") -> SnapshotRow {
        SnapshotRow(
            id: id,
            chainId: "bitcoin-mainnet",
            tick: "XC",
            displayName: "XChain",
            amountText: "42 XC",
            fiatText: "$1,234.56",
            noPrice: false,
            pendingText: "",
            unavailable: false,
            iconHash: "icon-cache",
            tickerColor: "#1A74A8",
            hasDetail: true
        )
    }
}
