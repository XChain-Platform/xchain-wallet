// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

@main
struct AccessibilityRequestLabelsCheck {
    private struct Expected {
        let pinned: String
        let lines: [String]
    }

    static func main() {
        let alerts: [String: String] = load(
            [String: String].self,
            path: "packages/core/src/watch/contract/strings-alerts.json"
        )
        let balances: [String: String] = load(
            [String: String].self,
            path: "packages/core/src/watch/contract/strings-balances.json"
        )
        let strings = balances.merging(alerts) { _, alert in alert }
        let localizedText: (String) -> String = { key in
            strings[key] ?? "<missing: \(key)>"
        }
        let spokenTime: (Int64) -> String = { value in
            "at:\(value)"
        }

        let fixtures: [(String, Expected)] = [
            (
                "request-confirm",
                Expected(
                    pinned: "1 request waiting",
                    lines: [
                        "Request, Confirm this Send request on your phone.",
                        "Amount, 0.025 BTC",
                    ]
                )
            ),
            (
                "request-expired",
                Expected(
                    pinned: "1 request waiting",
                    lines: [
                        "Request, This payment request has expired.",
                        "Amount, 48.50 USDC",
                        "This request expired.",
                    ]
                )
            ),
            (
                "request-paydue",
                Expected(
                    pinned: "1 request waiting",
                    lines: [
                        "Request, Payment is due for this request.",
                        "Amount, 125.00 USDC",
                        "Expires, at:4102444800000",
                    ]
                )
            ),
        ]

        for (fixtureName, expected) in fixtures {
            let request: Request = load(
                Request.self,
                path: "test/fixtures/watch/\(fixtureName).json"
            )
            let model = AlertsPresenter.request(request, now: 1_700_000_000_000)
            let pinned = AccessibilityLabels.requestPinned(model, text: localizedText)
            let lines = AccessibilityLabels.requestLines(
                model,
                text: localizedText,
                time: spokenTime
            )

            require(
                pinned == expected.pinned && lines == expected.lines,
                "fixture \(fixtureName): expected pinned \(expected.pinned) and lines "
                    + "\(expected.lines), got pinned \(pinned) and lines \(lines)"
            )
        }

        print("PASS: \(fixtures.count) request fixtures")
    }

    private static func load<Value: Decodable>(_ type: Value.Type, path: String) -> Value {
        do {
            let data = try Data(contentsOf: URL(fileURLWithPath: path))
            return try JSONDecoder().decode(type, from: data)
        } catch {
            fail("read \(path): \(error)")
        }
    }

    private static func require(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else {
            fail(name)
        }
    }

    private static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("FAIL: \(name)\n".utf8))
        exit(1)
    }
}
