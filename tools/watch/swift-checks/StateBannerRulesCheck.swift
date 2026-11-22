import Foundation

@main
enum StateBannerRulesCheck {
    static func main() {
        let now: Int64 = 200_000_000

        check(
            StateBannerRules.banners(
                hasSnapshot: false,
                session: "locked",
                reachable: false,
                balancesAt: now - 30 * 60 * 60 * 1_000,
                now: now
            ) == [.loading],
            "no snapshot has only loading banner"
        )
        check(
            StateBannerRules.ageLine(
                hasSnapshot: false,
                balancesAt: now - 30 * 60 * 60 * 1_000,
                now: now
            ) == nil,
            "no snapshot has no age line"
        )

        check(
            StateBannerRules.banners(
                hasSnapshot: true,
                session: "unlocked",
                reachable: true,
                balancesAt: now - 5 * 60 * 1_000,
                now: now
            ).isEmpty,
            "fresh reachable unlocked snapshot has no banner"
        )
        check(
            StateBannerRules.ageLine(
                hasSnapshot: true,
                balancesAt: now - 5 * 60 * 1_000,
                now: now
            ) == .age,
            "five minute snapshot has age line"
        )

        check(
            StateBannerRules.ageLine(
                hasSnapshot: true,
                balancesAt: now - 15 * 60 * 1_000,
                now: now
            ) == .age,
            "exactly fifteen minutes is not amber"
        )
        check(
            StateBannerRules.ageLine(
                hasSnapshot: true,
                balancesAt: now - (15 * 60 * 1_000 + 1),
                now: now
            ) == .ageAmber,
            "fifteen minutes plus one millisecond is amber"
        )

        check(
            !StateBannerRules.banners(
                hasSnapshot: true,
                session: "unlocked",
                reachable: true,
                balancesAt: now - (24 * 60 * 60 * 1_000 - 60 * 1_000),
                now: now
            ).contains(.stale24h),
            "twenty three hours fifty nine minutes is not stale"
        )
        check(
            StateBannerRules.banners(
                hasSnapshot: true,
                session: "unlocked",
                reachable: true,
                balancesAt: now - 24 * 60 * 60 * 1_000,
                now: now
            ) == [.stale24h],
            "exactly twenty four hours is stale"
        )

        check(
            StateBannerRules.banners(
                hasSnapshot: true,
                session: "locked",
                reachable: false,
                balancesAt: now - 25 * 60 * 60 * 1_000,
                now: now
            ) == [.locked, .unreachable, .stale24h],
            "locked unreachable stale banners are ordered"
        )
        check(
            StateBannerRules.ageLine(
                hasSnapshot: true,
                balancesAt: now - 25 * 60 * 60 * 1_000,
                now: now
            ) == .ageAmber,
            "locked stale snapshot keeps amber age line"
        )

        for session in [nil, "", "unknown"] as [String?] {
            check(
                !StateBannerRules.banners(
                    hasSnapshot: true,
                    session: session,
                    reachable: true,
                    balancesAt: now,
                    now: now
                ).contains(.locked),
                "only the exact locked session is locked"
            )
        }

        check(
            StateBannerRules.banners(
                hasSnapshot: true,
                session: "unlocked",
                reachable: true,
                balancesAt: nil,
                now: now
            ).isEmpty,
            "missing balance timestamp is not stale"
        )
        check(
            StateBannerRules.ageLine(hasSnapshot: true, balancesAt: nil, now: now) == nil,
            "missing balance timestamp has no age line"
        )

        let expectedKeys: [(String, String)] = [
            (StateBannerRules.textKey(.loading), "state.loading"),
            (StateBannerRules.textKey(.locked), "state.locked"),
            (StateBannerRules.textKey(.unreachable), "state.unreachable"),
            (StateBannerRules.textKey(.stale24h), "state.stale24h"),
            (StateBannerRules.textKey(WatchAgeLine.age), "state.age"),
            (StateBannerRules.textKey(WatchAgeLine.ageAmber), "state.ageAmber")
        ]
        let contract = readContract()
        for (actual, expected) in expectedKeys {
            check(actual == expected, "text key \(expected) matches contract")
            check(contract[actual] != nil, "text key \(expected) exists in contract")
        }
    }

    private static func readContract() -> [String: Any] {
        let path = "packages/core/src/watch/contract/strings-balances.json"
        do {
            let data = try Data(contentsOf: URL(fileURLWithPath: path))
            guard let contract = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                fail("contract is not a JSON object")
            }
            return contract
        } catch {
            fail("cannot read contract: \(error)")
        }
    }

    private static func check(_ condition: @autoclosure () -> Bool, _ name: String) {
        if !condition() {
            fail(name)
        }
    }

    private static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
        exit(1)
    }
}
