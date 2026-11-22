import Foundation

enum WatchBanner: String, CaseIterable {
    case loading
    case locked
    case unreachable
    case stale24h
}

enum WatchAgeLine: String {
    case age
    case ageAmber
}

enum StateBannerRules {
    static func banners(
        hasSnapshot: Bool,
        session: String?,
        reachable: Bool,
        balancesAt: Int64?,
        now: Int64
    ) -> [WatchBanner] {
        guard hasSnapshot else {
            return [.loading]
        }

        var banners: [WatchBanner] = []
        if session == "locked" {
            banners.append(.locked)
        }
        if !reachable {
            banners.append(.unreachable)
        }
        if let balancesAt, WatchAge.of(balancesAt: balancesAt, now: now).bucket == .day {
            banners.append(.stale24h)
        }
        return banners
    }

    static func ageLine(hasSnapshot: Bool, balancesAt: Int64?, now: Int64) -> WatchAgeLine? {
        guard hasSnapshot, let balancesAt else {
            return nil
        }
        return WatchAge.of(balancesAt: balancesAt, now: now).amber ? .ageAmber : .age
    }

    static func textKey(_ banner: WatchBanner) -> String {
        "state.\(banner.rawValue)"
    }

    static func textKey(_ line: WatchAgeLine) -> String {
        "state.\(line.rawValue)"
    }
}
