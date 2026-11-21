import Foundation

@main
enum ActivityCheckRulesCheck {
    static func main() {
        check(
            "design budget constants",
            ActivityCheckRules.maxAddresses == 20
                && ActivityCheckRules.parallel == 4
                && ActivityCheckRules.requestTimeoutSeconds == 10
                && ActivityCheckRules.runBudgetSeconds == 25
        )

        let addresses = (0..<25).map { "address-\($0)" }
        var lastCheckedAt: [String: Int64] = [:]
        for index in 0..<25 where index != 3 && index != 21 {
            lastCheckedAt[addresses[index]] = Int64(100 + index)
        }
        let expectedOldest = [addresses[3], addresses[21]] + addresses.filter {
            $0 != addresses[3] && $0 != addresses[21]
        }.prefix(18)
        check(
            "25 addresses pick the 20 oldest with never-checked first",
            ActivityCheckRules.pick(
                addresses,
                lastCheckedAt: lastCheckedAt,
                max: ActivityCheckRules.maxAddresses
            ) == Array(expectedOldest)
        )

        check(
            "duplicates counted once",
            ActivityCheckRules.pick(
                ["a", "b", "a", "c", "b"],
                lastCheckedAt: [:],
                max: 10
            ) == ["a", "b", "c"]
        )

        check(
            "tie order",
            ActivityCheckRules.pick(
                ["c", "a", "b"],
                lastCheckedAt: ["a": 7, "b": 2, "c": 7],
                max: 3
            ) == ["b", "c", "a"]
        )

        check(
            "max 0",
            ActivityCheckRules.pick(
                ["a"],
                lastCheckedAt: [:],
                max: 0
            ).isEmpty
        )

        var baseline: [String: [String]] = [:]
        check(
            "first sight returns false and stores",
            !ActivityCheckRules.applyReads(
                baseline: &baseline,
                reads: ["a": ["confirmed", "pending"]]
            ) && baseline["a"] == ["confirmed", "pending"]
        )

        check(
            "equal read returns false",
            !ActivityCheckRules.applyReads(
                baseline: &baseline,
                reads: ["a": ["confirmed", "pending"]]
            ) && baseline["a"] == ["confirmed", "pending"]
        )

        check(
            "changed pending string returns true",
            ActivityCheckRules.applyReads(
                baseline: &baseline,
                reads: ["a": ["confirmed", "pending-2"]]
            ) && baseline["a"] == ["confirmed", "pending-2"]
        )

        check(
            "nil read keeps the baseline and returns false",
            !ActivityCheckRules.applyReads(
                baseline: &baseline,
                reads: ["a": nil]
            ) && baseline["a"] == ["confirmed", "pending-2"]
        )
    }

    private static func check(_ name: String, _ passed: @autoclosure () -> Bool) {
        guard passed() else {
            print("FAIL: \(name)")
            exit(1)
        }
    }
}
