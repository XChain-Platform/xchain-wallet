import Foundation

enum RelativeTimeText {
    static func ageKey(balancesAt: Int64, now: Int64) -> (key: String, n: Int) {
        let age = WatchAge.of(balancesAt: balancesAt, now: now)
        switch age.bucket {
        case .justNow:
            return ("state.ageJustNow", 0)
        case .minutes:
            return ("state.ageMinutes", age.n)
        case .hours:
            return ("state.ageHours", age.n)
        case .day:
            return ("state.stale24h", 0)
        }
    }

    static func alertKey(at: Int64, now: Int64) -> (key: String, n: Int) {
        let age = WatchAge.of(balancesAt: at, now: now)
        switch age.bucket {
        case .justNow:
            return ("w3.timeJustNow", 0)
        case .minutes:
            return ("w3.timeMinutes", age.n)
        case .hours:
            return ("w3.timeHours", age.n)
        case .day:
            return ("w3.timeDays", age.n / 24)
        }
    }

    static func fill(_ template: String, n: Int) -> String {
        template.replacingOccurrences(of: "{n}", with: String(n))
    }
}
