// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import XCTest
@testable import WatchApp

final class MessagesDecodeTests: XCTestCase {
    func testDecodesEveryRequestFixture() throws {
        typealias Expected = (
            id: String,
            kind: String,
            iconHash: String,
            sentence: String,
            amountText: String,
            expiresAt: Int64?
        )
        let expected: [String: Expected] = [
            "request-confirm": (
                "1023456789abcdef0123456789abcdef", "request",
                "0a1b2c3d4e5f67890123456789abcdef0a1b2c3d4e5f67890123456789abcdef",
                "Confirm this Send request on your phone.", "0.025 BTC", nil
            ),
            "request-paydue": (
                "2123456789abcdef0123456789abcdef", "paydue",
                "1b2c3d4e5f67890123456789abcdef0a1b2c3d4e5f67890123456789abcdef0a",
                "Payment is due for this request.", "125.00 USDC", 4_102_444_800_000
            ),
            "request-expired": (
                "3123456789abcdef0123456789abcdef", "paydue",
                "2c3d4e5f67890123456789abcdef0a1b2c3d4e5f67890123456789abcdef0a1b",
                "This payment request has expired.", "48.50 USDC", 946_684_800_000
            ),
        ]
        let directory = try XCTUnwrap(WatchFixtureFiles.directory())
        let names = WatchFixtureFiles.names(prefix: "request-", in: directory)

        XCTAssertEqual(names, expected.keys.sorted())
        for name in names {
            let request = try JSONDecoder().decode(
                Request.self,
                from: WatchFixtureFiles.data(name, in: directory)
            )
            let value = try XCTUnwrap(expected[name])
            XCTAssertEqual(request.id, value.id, name)
            XCTAssertEqual(request.kind.rawValue, value.kind, name)
            XCTAssertEqual(request.iconHash, value.iconHash, name)
            XCTAssertEqual(request.sentence, value.sentence, name)
            XCTAssertEqual(request.amountText, value.amountText, name)
            XCTAssertEqual(request.expiresAt, value.expiresAt, name)
        }
    }
}
