// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

@main
struct AccessibilityLabelsCheck {
    private struct ExpectedText: Decodable {
        let key: String?
        let text: String?
    }

    private struct ExpectedLine: Decodable {
        let name: String?
        let primary: ExpectedText?
        let secondary: ExpectedText?
        let key: String?
    }

    private struct ExpectedDisplay: Decodable {
        let lines: [ExpectedLine]
        let a11y: [String]?
    }

    static func main() {
        let fixtures: [String: [String: ExpectedDisplay]] = load(
            [String: [String: ExpectedDisplay]].self,
            path: "test/fixtures/watch/expected/balances.json"
        )
        let strings: [String: String] = load(
            [String: String].self,
            path: "packages/core/src/watch/contract/strings-balances.json"
        )
        let localizedText: (String) -> String = { key in
            strings[key] ?? "<missing: \(key)>"
        }

        var fixtureModeCount = 0
        for fixtureName in fixtures.keys.sorted() {
            guard let modes = fixtures[fixtureName] else {
                fail("fixture \(fixtureName)")
            }
            for modeName in ["fiat", "units"] {
                guard let expectedDisplay = modes[modeName] else {
                    fail("fixture \(fixtureName), missing mode \(modeName)")
                }
                fixtureModeCount += 1
                let display = makeDisplay(lines: expectedDisplay.lines)
                let actual = AccessibilityLabels.balanceLines(display, text: localizedText)
                require(
                    actual == expectedDisplay.a11y ?? [],
                    "fixture \(fixtureName), mode \(modeName): expected "
                        + "\(expectedDisplay.a11y ?? []), got \(actual)"
                )
            }
        }

        let cases: [(String, BalanceLine, String)] = [
            (
                "keyed empty line",
                BalanceLine(key: "w1.empty"),
                "No balances yet"
            ),
            (
                "hidden primary",
                BalanceLine(
                    name: "Bitcoin",
                    primary: BalanceText(key: "state.hidden")
                ),
                "Bitcoin, Amount hidden"
            ),
            (
                "unavailable primary",
                BalanceLine(
                    name: "Bitcoin",
                    primary: BalanceText(key: "state.balanceUnavailable")
                ),
                "Bitcoin, Balance unavailable"
            ),
            (
                "unpriced row",
                BalanceLine(
                    name: "Pepe Cash",
                    primary: BalanceText(text: "No price yet"),
                    secondary: BalanceText(text: "1,000 PEPECASH")
                ),
                "Pepe Cash, No price yet, 1,000 PEPECASH"
            ),
        ]
        for (caseName, line, expected) in cases {
            let display = makeDisplay(lines: [line])
            require(
                AccessibilityLabels.balanceLines(display, text: localizedText) == [expected],
                caseName
            )
        }

        print("PASS: \(fixtureModeCount) fixture modes and \(cases.count) hand-built cases")
    }

    private static func makeDisplay(lines: [ExpectedLine]) -> BalancesDisplay {
        makeDisplay(
            lines: lines.map { line in
                BalanceLine(
                    name: line.name,
                    primary: line.primary.map(makeText),
                    secondary: line.secondary.map(makeText),
                    key: line.key
                )
            }
        )
    }

    private static func makeDisplay(lines: [BalanceLine]) -> BalancesDisplay {
        BalancesDisplay(
            header: nil,
            lines: lines,
            banners: [],
            ageLine: nil,
            ageSeverity: nil,
            requestKey: nil
        )
    }

    private static func makeText(_ expected: ExpectedText) -> BalanceText {
        BalanceText(key: expected.key, text: expected.text)
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
