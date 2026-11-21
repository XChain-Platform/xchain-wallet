// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import Foundation

@main
enum WatchMessagesCheck {
    private struct FailedCheck: Error {}

    static func main() {
        verify("request without expiresAt decodes") {
            let request = try decode(Request.self, from: """
                {"id":"a1","kind":"request","iconHash":"icon","sentence":"Send 1 XCH","amountText":"1 XCH"}
                """)
            try require(request.kind == .request && request.expiresAt == nil)
        }

        verify("paydue with expiresAt decodes") {
            let request = try decode(Request.self, from: """
                {"id":"a2","kind":"paydue","iconHash":"icon","sentence":"Payment due","amountText":"2 XCH","expiresAt":123}
                """)
            try require(request.kind == .paydue && request.expiresAt == 123)
        }

        verify("unknown request kind fails") {
            let data = Data("""
                {"id":"a3","kind":"unknown","iconHash":"icon","sentence":"Unknown","amountText":"3 XCH"}
                """.utf8)
            let rejected: Bool
            do {
                _ = try JSONDecoder().decode(Request.self, from: data)
                rejected = false
            } catch {
                rejected = true
            }
            try require(rejected)
        }

        verify("minimal detail has nil optionals") {
            let detail = try decode(Detail.self, from: """
                {"v":1,"tokenId":"xch"}
                """)
            try require(
                detail.artworkHash == nil
                    && detail.changeText == nil
                    && detail.priceSourceText == nil
                    && detail.chart == nil
                    && detail.facts == nil
                    && detail.description == nil
            )
        }

        verify("48-point chart preserves point order") {
            let points = (0..<48).map(Double.init)
            let data = try JSONSerialization.data(withJSONObject: [
                "v": 1,
                "tokenId": "xch",
                "chart": ["points": points, "up": true],
            ])
            let detail = try JSONDecoder().decode(Detail.self, from: data)
            try require(detail.chart?.points == points)
        }

        verify("MarkReadIntent encodes exactly") {
            let data = try JSONEncoder().encode(MarkReadIntent(id: "a1"))
            try require(String(decoding: data, as: UTF8.self) == #"{"id":"a1"}"#)
        }

        verify("RefreshIntent encodes exactly") {
            let data = try JSONEncoder().encode(RefreshIntent())
            try require(String(decoding: data, as: UTF8.self) == "{}")
        }
    }

    private static func decode<Value: Decodable>(
        _ type: Value.Type,
        from json: String
    ) throws -> Value {
        try JSONDecoder().decode(type, from: Data(json.utf8))
    }

    private static func require(_ condition: @autoclosure () -> Bool) throws {
        guard condition() else { throw FailedCheck() }
    }

    private static func verify(_ name: String, _ body: () throws -> Void) {
        do {
            try body()
        } catch {
            FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
            exit(1)
        }
    }
}
