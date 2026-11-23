// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import XCTest
@testable import WatchApp

final class ReceiveScreenTests: XCTestCase {
    func testNoAddressUsesTheEmptyState() {
        let pages = ReceivePresentation.pages(nil)

        XCTAssertTrue(pages.isEmpty)
        XCTAssertEqual(ReceivePresentation.emptyKey, "w6.empty")
    }

    func testEachChainGetsOnePageInSnapshotOrder() {
        let bitcoin = entry(chainId: "bitcoin-mainnet", address: "bc1prawaddress", bits: "oA==")
        let litecoin = entry(chainId: "litecoin-mainnet", address: "ltc1rawaddress", bits: "UA==")
        let duplicate = entry(chainId: "bitcoin-mainnet", address: "laterduplicate", bits: "AA==")
        let pages = ReceivePresentation.pages([bitcoin, litecoin, duplicate])

        XCTAssertEqual(pages.map(\.chainId), ["bitcoin-mainnet", "litecoin-mainnet"])
        XCTAssertEqual(pages.map(\.address), ["bc1prawaddress", "ltc1rawaddress"])
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
        let entry = entry(chainId: "bitcoin", address: "bc1praw", bits: "oA==")

        XCTAssertEqual(ReceivePresentation.modules(for: entry), [true, false, true, false])
    }

    func testRejectsAnInvalidQrMatrix() {
        let entry = entry(chainId: "bitcoin", address: "bc1praw", bits: "")

        XCTAssertNil(ReceivePresentation.modules(for: entry))
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
