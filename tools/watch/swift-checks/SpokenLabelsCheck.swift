// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

@main
struct SpokenLabelsCheck {
    static func main() {
        checkBalanceRow(
            name: "Bitcoin",
            primary: "$1,234.56",
            secondary: nil,
            pendingText: nil,
            redacted: false,
            unavailable: false,
            expected: "Bitcoin, $1,234.56",
            caseName: "priced Bitcoin"
        )
        checkBalanceRow(
            name: "Bitcoin",
            primary: "0.5 BTC",
            secondary: nil,
            pendingText: nil,
            redacted: false,
            unavailable: false,
            expected: "Bitcoin, 0.5 BTC",
            caseName: "Bitcoin units"
        )
        checkBalanceRow(
            name: "PEPECASH",
            primary: "No price yet",
            secondary: "1,000 PEPECASH",
            pendingText: nil,
            redacted: false,
            unavailable: false,
            expected: "PEPECASH, No price yet, 1,000 PEPECASH",
            caseName: "unpriced fiat row"
        )
        checkBalanceRow(
            name: "Bitcoin",
            primary: "0.5 BTC",
            secondary: nil,
            pendingText: "+0.1 pending",
            redacted: false,
            unavailable: false,
            expected: "Bitcoin, 0.5 BTC, +0.1 pending",
            caseName: "pending Bitcoin"
        )
        checkBalanceRow(
            name: "Bitcoin",
            primary: "0.5 BTC",
            secondary: nil,
            pendingText: "+0.1 pending",
            redacted: true,
            unavailable: false,
            expected: "Bitcoin, Amount hidden",
            caseName: "redacted Bitcoin"
        )
        checkBalanceRow(
            name: "Bitcoin",
            primary: "0.5 BTC",
            secondary: nil,
            pendingText: "+0.1 pending",
            redacted: true,
            unavailable: true,
            expected: "Bitcoin, Balance unavailable",
            caseName: "unavailable redacted Bitcoin"
        )
        checkBalanceRow(
            name: "Bitcoin",
            primary: "0.5 BTC",
            secondary: "",
            pendingText: "",
            redacted: false,
            unavailable: false,
            expected: "Bitcoin, 0.5 BTC",
            caseName: "empty optional row text"
        )

        let lineCases: [([String?], String, String)] = [
            (["1 request waiting"], "1 request waiting", "single request line"),
            (
                ["Send 0.5 BTC", nil, "", "  ", "0.5 BTC", "Expires in 10 min"],
                "Send 0.5 BTC, 0.5 BTC, Expires in 10 min",
                "send sentence amount and expiry"
            ),
            ([], "", "empty lines"),
            ([nil, ""], "", "nil and empty lines"),
        ]
        for (parts, expected, caseName) in lineCases {
            require(SpokenLabels.lines(parts) == expected, caseName)
        }

        let strings = loadBalanceStrings()
        require(strings[SpokenLabels.hiddenKey] != nil, "contract key \(SpokenLabels.hiddenKey)")
        require(
            strings[SpokenLabels.unavailableKey] != nil,
            "contract key \(SpokenLabels.unavailableKey)"
        )
    }

    private static func checkBalanceRow(
        name: String,
        primary: String,
        secondary: String?,
        pendingText: String?,
        redacted: Bool,
        unavailable: Bool,
        expected: String,
        caseName: String
    ) {
        let actual = SpokenLabels.balanceRow(
            name: name,
            primary: primary,
            secondary: secondary,
            pendingText: pendingText,
            redacted: redacted,
            unavailable: unavailable,
            hiddenText: "Amount hidden",
            unavailableText: "Balance unavailable"
        )
        require(actual == expected, caseName)
    }

    private static func loadBalanceStrings() -> [String: Any] {
        let path = "packages/core/src/watch/contract/strings-balances.json"

        do {
            let data = try Data(contentsOf: URL(fileURLWithPath: path))
            guard let strings = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                fail("balance strings object")
            }
            return strings
        } catch {
            fail("read balance strings: \(error)")
        }
    }

    private static func require(_ condition: @autoclosure () -> Bool, _ caseName: String) {
        guard condition() else {
            fail(caseName)
        }
    }

    private static func fail(_ caseName: String) -> Never {
        FileHandle.standardError.write(Data("FAILED: \(caseName)\n".utf8))
        exit(1)
    }
}
