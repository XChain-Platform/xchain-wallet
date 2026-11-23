// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import XCTest
@testable import WatchApp

final class ReceiveScreenTests: XCTestCase {
    func testNoAddressUsesTheEmptyState() {
        let screen = ReceiveScreen(receive: nil)

        XCTAssertTrue(screen.pages.isEmpty)
        XCTAssertEqual(ReceivePresentation.emptyKey, "w6.empty")
        _ = screen.body
    }

    func testEachChainGetsOnePageInSnapshotOrder() {
        let bitcoin = entry(chainId: "bitcoin-mainnet", address: "bc1prawaddress", bits: "oA==")
        let litecoin = entry(chainId: "litecoin-mainnet", address: "ltc1rawaddress", bits: "UA==")
        let duplicate = entry(chainId: "bitcoin-mainnet", address: "laterduplicate", bits: "AA==")
        let screen = ReceiveScreen(receive: [bitcoin, litecoin, duplicate])

        XCTAssertEqual(screen.pages.map(\.chainId), ["bitcoin-mainnet", "litecoin-mainnet"])
        XCTAssertEqual(screen.pages.map(\.address), ["bc1prawaddress", "ltc1rawaddress"])
        _ = screen.body
    }

    func testGroupsRawAndAlreadyGroupedAddresses() {
        XCTAssertEqual(
            ReceivePresentation.groupedAddress("  bc1qw508d6qejx  "),
            "bc1q w508 d6qe jx"
        )
        XCTAssertEqual(
            ReceivePresentation.groupedAddress("bc1q w508 d6qe jx"),
            "bc1q w508 d6qe jx"
        )
    }

    func testUsesAnIconForEachChainFamilyAndFallback() {
        XCTAssertEqual(ReceivePresentation.chainIconName(for: "bitcoin-mainnet"), "bitcoinsign.circle")
        XCTAssertEqual(ReceivePresentation.chainIconName(for: "litecoin-testnet"), "l.circle")
        XCTAssertEqual(ReceivePresentation.chainIconName(for: "dogecoin-regtest"), "d.circle")
        XCTAssertEqual(ReceivePresentation.chainIconName(for: "unknown-mainnet"), "link")
    }

    func testDecodesTheQrMatrix() {
        let page = ReceivePage(entry: entry(chainId: "bitcoin", address: "bc1praw", bits: "oA=="))

        XCTAssertEqual(page.modules, [true, false, true, false])
        XCTAssertEqual(page.iconName, "bitcoinsign.circle")
        XCTAssertEqual(page.addressText, "bc1p raw")
        _ = page.body
    }

    func testRejectsAnInvalidQrMatrix() {
        let page = ReceivePage(entry: entry(chainId: "bitcoin", address: "bc1praw", bits: ""))

        XCTAssertNil(page.modules)
    }

    func testBuildsTheQrMatrixView() {
        let matrix = ReceiveQRMatrix(size: 2, modules: [true, false, true, false])

        XCTAssertEqual(matrix.size, 2)
        XCTAssertEqual(matrix.modules, [true, false, true, false])
        _ = matrix.body
    }

    private func entry(chainId: String, address: String, bits: String) -> SnapshotReceive {
        SnapshotReceive(
            chainId: chainId,
            label: chainId.capitalized,
            address: address,
            qr: SnapshotQr(size: 2, bits: bits)
        )
    }
}
