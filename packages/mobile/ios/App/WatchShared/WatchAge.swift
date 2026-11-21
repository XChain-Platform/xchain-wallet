import Foundation

enum WatchAge {
    enum Bucket: String {
        case justNow
        case minutes
        case hours
        case day
    }

    static func of(balancesAt: Int64, now: Int64) -> (bucket: Bucket, n: Int, amber: Bool) {
        let elapsedMilliseconds: Int64
        if now <= balancesAt {
            elapsedMilliseconds = 0
        } else {
            let (difference, overflow) = now.subtractingReportingOverflow(balancesAt)
            elapsedMilliseconds = overflow ? .max : difference
        }
        let elapsedMinutes = elapsedMilliseconds / 60_000
        let amber = elapsedMilliseconds > 15 * 60_000

        if elapsedMilliseconds < 60_000 {
            return (.justNow, 0, amber)
        }
        if elapsedMinutes < 60 {
            return (.minutes, Int(elapsedMinutes), amber)
        }

        let elapsedHours = elapsedMinutes / 60
        if elapsedHours < 24 {
            return (.hours, Int(elapsedHours), amber)
        }
        return (.day, Int(elapsedHours), amber)
    }
}
