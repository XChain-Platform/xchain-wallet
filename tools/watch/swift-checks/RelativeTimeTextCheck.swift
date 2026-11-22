import Foundation

@main
enum RelativeTimeTextCheck {
    private struct KeyCase {
        let name: String
        let timestamp: Int64
        let now: Int64
        let age: (key: String, n: Int)
        let alert: (key: String, n: Int)
    }

    static func main() {
        let sharedCases = [
            KeyCase(
                name: "elapsed 0",
                timestamp: 0,
                now: 0,
                age: ("state.ageJustNow", 0),
                alert: ("w3.timeJustNow", 0)
            ),
            KeyCase(
                name: "one minute in future",
                timestamp: 60_000,
                now: 0,
                age: ("state.ageJustNow", 0),
                alert: ("w3.timeJustNow", 0)
            ),
            KeyCase(
                name: "59999 ms",
                timestamp: 0,
                now: 59_999,
                age: ("state.ageJustNow", 0),
                alert: ("w3.timeJustNow", 0)
            ),
            KeyCase(
                name: "60000 ms",
                timestamp: 0,
                now: 60_000,
                age: ("state.ageMinutes", 1),
                alert: ("w3.timeMinutes", 1)
            ),
            KeyCase(
                name: "59 min 59 s",
                timestamp: 0,
                now: 3_599_000,
                age: ("state.ageMinutes", 59),
                alert: ("w3.timeMinutes", 59)
            ),
            KeyCase(
                name: "60 min",
                timestamp: 0,
                now: 3_600_000,
                age: ("state.ageHours", 1),
                alert: ("w3.timeHours", 1)
            ),
            KeyCase(
                name: "23 h 59 min",
                timestamp: 0,
                now: 86_340_000,
                age: ("state.ageHours", 23),
                alert: ("w3.timeHours", 23)
            ),
            KeyCase(
                name: "24 h",
                timestamp: 0,
                now: 86_400_000,
                age: ("state.stale24h", 0),
                alert: ("w3.timeDays", 1)
            ),
        ]

        for testCase in sharedCases {
            let result = RelativeTimeText.ageKey(
                balancesAt: testCase.timestamp,
                now: testCase.now
            )
            check(
                "ageKey \(testCase.name)",
                result,
                expected: testCase.age
            )
        }

        let alertCases = sharedCases.map { ($0.name, $0.timestamp, $0.now, $0.alert) } + [
            ("47 h 59 min", 0, 172_740_000, ("w3.timeDays", 1)),
            ("48 h", 0, 172_800_000, ("w3.timeDays", 2)),
            ("30 days", 0, 2_592_000_000, ("w3.timeDays", 30)),
        ]
        for (name, timestamp, now, expected) in alertCases {
            let result = RelativeTimeText.alertKey(at: timestamp, now: now)
            check(
                "alertKey \(name)",
                result,
                expected: expected
            )
        }

        let fillCases = [
            ("Updated {n} min ago", 12, "Updated 12 min ago"),
            ("{n} d ago", 0, "0 d ago"),
            ("{n} of {n}", 3, "3 of 3"),
            ("Just now", 5, "Just now"),
        ]
        for (template, n, expected) in fillCases {
            guard RelativeTimeText.fill(template, n: n) == expected else {
                fail("fill \(template)")
            }
        }
    }

    private static func check(
        _ name: String,
        _ result: (key: String, n: Int),
        expected: (key: String, n: Int)
    ) {
        guard result.key == expected.key, result.n == expected.n else {
            fail(name)
        }
    }

    private static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
        exit(1)
    }
}
