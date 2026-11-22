// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

@main
struct BalancesLayoutCheck {
    static func main() {
        check(
            BalancesLayout.items(rowCount: 0, hasRequest: false, capped: false) == [.empty],
            "no rows without a request"
        )
        check(
            BalancesLayout.items(rowCount: 0, hasRequest: true, capped: false) == [.request, .empty],
            "no rows with a request"
        )
        check(
            BalancesLayout.items(rowCount: 3, hasRequest: true, capped: false)
                == [.request, .row(0), .row(1), .row(2)],
            "three rows with a request"
        )

        check(BalancesLayout.rowLimit == 50, "row limit")
        let fiftyRows = (0..<50).map(BalancesLayout.Item.row)
        check(
            BalancesLayout.items(rowCount: 50, hasRequest: false, capped: true)
                == fiftyRows + [.moreOnPhone],
            "fifty capped rows"
        )
        check(
            BalancesLayout.items(rowCount: 60, hasRequest: false, capped: false) == fiftyRows,
            "sixty rows clamped to fifty"
        )
        check(
            BalancesLayout.items(rowCount: 0, hasRequest: false, capped: true) == [.empty],
            "capped with no rows"
        )
        check(
            BalancesLayout.items(rowCount: -1, hasRequest: false, capped: false) == [.empty],
            "negative row count"
        )

        let keyedItems: [(BalancesLayout.Item, String)] = [
            (.request, "w1.requestWaiting"),
            (.moreOnPhone, "state.moreOnPhone"),
            (.empty, "w1.empty"),
        ]
        for (item, expectedKey) in keyedItems {
            check(BalancesLayout.textKey(item) == expectedKey, "text key \(expectedKey)")
        }
        check(BalancesLayout.textKey(.row(0)) == nil, "row text key")

        let strings = loadBalanceStrings()
        for (_, key) in keyedItems {
            check(strings[key] != nil, "contract key \(key)")
        }

        check(BalancesLayout.headerKey(fiatMode: false) == "w1.title", "units header")
        check(BalancesLayout.headerKey(fiatMode: true) == nil, "fiat header")
        check(strings["w1.title"] != nil, "contract key w1.title")

        checkAmountCell(
            BalancesLayout.amountCell(
                fiatMode: false,
                amountText: "12 XCN",
                fiatText: "$6.00",
                noPrice: true
            ),
            primary: "12 XCN",
            secondary: nil,
            name: "units amount cell"
        )
        checkAmountCell(
            BalancesLayout.amountCell(
                fiatMode: true,
                amountText: "12 XCN",
                fiatText: "$6.00",
                noPrice: false
            ),
            primary: "$6.00",
            secondary: nil,
            name: "priced fiat amount cell"
        )
        checkAmountCell(
            BalancesLayout.amountCell(
                fiatMode: true,
                amountText: "12 XCN",
                fiatText: "No price yet",
                noPrice: true
            ),
            primary: "No price yet",
            secondary: "12 XCN",
            name: "unpriced fiat amount cell"
        )
    }

    private static func loadBalanceStrings() -> [String: String] {
        let path = "packages/core/src/watch/contract/strings-balances.json"

        do {
            let data = try Data(contentsOf: URL(fileURLWithPath: path))
            guard let strings = try JSONSerialization.jsonObject(with: data) as? [String: String] else {
                fail("balance strings object")
            }
            return strings
        } catch {
            fail("read balance strings: \(error)")
        }
    }

    private static func checkAmountCell(
        _ cell: (primary: String, secondary: String?),
        primary: String,
        secondary: String?,
        name: String
    ) {
        check(cell.primary == primary && cell.secondary == secondary, name)
    }

    private static func check(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else {
            fail(name)
        }
    }

    private static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("FAIL: \(name)\n".utf8))
        exit(1)
    }
}
