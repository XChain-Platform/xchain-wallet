// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation
import XCTest
@testable import WatchApp

final class TokenDetailPresenterTests: XCTestCase {
    func testDecodesAndPresentsEveryDetailFixture() throws {
        let directory = try XCTUnwrap(WatchFixtureFiles.directory())
        let names = WatchFixtureFiles.names(prefix: "detail-", in: directory)
        XCTAssertFalse(names.isEmpty)

        for name in names {
            let detail = try decode(name, in: directory)
            let display = TokenDetailPresenter.present(
                row: row(id: detail.tokenId),
                detail: detail,
                phoneReachable: true
            )

            XCTAssertEqual(display.tokenId, detail.tokenId, name)
            XCTAssertEqual(display.facts.count, detail.facts?.count ?? 0, name)
        }
    }

    func testCachedArtworkUsesGlyphUntilTheFileLands() throws {
        let detail = try fixture("detail-cached")
        let waiting = TokenDetailPresenter.present(
            row: row(id: detail.tokenId),
            detail: detail,
            phoneReachable: true
        )

        XCTAssertNil(waiting.artworkHash)
        XCTAssertEqual(waiting.glyph, "X")
        XCTAssertEqual(waiting.glyphRGB, [26 / 255.0, 116 / 255.0, 168 / 255.0])

        let landed = TokenDetailPresenter.present(
            row: row(id: detail.tokenId),
            detail: detail,
            phoneReachable: true,
            availableArtworkHashes: ["xc-artwork-cache"]
        )
        XCTAssertEqual(landed.artworkHash, "xc-artwork-cache")
        XCTAssertNil(landed.glyph)
        XCTAssertNil(landed.glyphRGB)
        XCTAssertEqual(landed.facts.count, 5)
        XCTAssertNil(landed.notice)
    }

    func testAbsentArtworkAlwaysUsesTheTickerGlyph() throws {
        let detail = try fixture("detail-noart")
        let display = TokenDetailPresenter.present(
            row: row(id: detail.tokenId),
            detail: detail,
            phoneReachable: true
        )

        XCTAssertNil(display.artworkHash)
        XCTAssertEqual(display.glyph, "X")
    }

    func testNativeChartIsKeptWithItsDirection() throws {
        let detail = try fixture("detail-native")
        let display = TokenDetailPresenter.present(
            row: row(id: detail.tokenId, tick: "BTC"),
            detail: detail,
            phoneReachable: true
        )

        XCTAssertEqual(display.chart?.points.count, 48)
        XCTAssertEqual(display.chart?.up, false)
        XCTAssertNil(display.notice)
    }

    func testHiddenAndUnpricedDetailsDropTheChart() throws {
        let detail = try fixture("detail-native")
        let hidden = TokenDetailPresenter.present(
            row: row(id: detail.tokenId, tick: "BTC"),
            detail: detail,
            phoneReachable: true,
            redacted: true
        )
        let unpriced = TokenDetailPresenter.present(
            row: row(id: detail.tokenId, tick: "BTC", noPrice: true),
            detail: detail,
            phoneReachable: true
        )

        XCTAssertEqual(hidden.amountText, "••••")
        XCTAssertEqual(hidden.valueText, "••••")
        XCTAssertNil(hidden.chart)
        XCTAssertNil(unpriced.chart)
    }

    func testMissingAndFailedDetailsHaveDistinctNotices() throws {
        let displayRow = row(id: "bitcoin-mainnet:XC")
        let away = TokenDetailPresenter.present(
            row: displayRow,
            detail: nil,
            phoneReachable: false
        )
        let failed = TokenDetailPresenter.present(
            row: displayRow,
            detail: try fixture("detail-loaderror"),
            phoneReachable: true
        )

        XCTAssertEqual(away.notice, .moreDetailsWhenNear)
        XCTAssertEqual(failed.notice, .detailsUnavailable)
        XCTAssertTrue(failed.facts.isEmpty)
    }

    private func fixture(_ name: String) throws -> Detail {
        let directory = try XCTUnwrap(WatchFixtureFiles.directory())
        return try decode(name, in: directory)
    }

    private func decode(_ name: String, in directory: URL) throws -> Detail {
        try JSONDecoder().decode(
            Detail.self,
            from: WatchFixtureFiles.data(name, in: directory)
        )
    }

    private func row(
        id: String,
        tick: String = "XC",
        noPrice: Bool = false
    ) -> SnapshotRow {
        SnapshotRow(
            id: id,
            chainId: "bitcoin-mainnet",
            tick: tick,
            displayName: tick == "BTC" ? "Bitcoin" : "XChain",
            amountText: tick == "BTC" ? "0.50 BTC" : "42 XC",
            fiatText: noPrice ? "No price yet" : "$1,234.56",
            noPrice: noPrice,
            pendingText: "",
            unavailable: false,
            iconHash: "icon-cache",
            tickerColor: "#1A74A8",
            hasDetail: true
        )
    }
}
