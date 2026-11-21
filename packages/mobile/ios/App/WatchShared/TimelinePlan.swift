import Foundation

enum TimelinePlan {
    private static let minuteMilliseconds: Int64 = 60_000
    private static let hourMilliseconds: Int64 = 60 * minuteMilliseconds

    static func entryDates(balancesAt: Int64, now: Int64, limit: Int = 60) -> [Int64] {
        let entryLimit = max(1, limit)
        var dates = [now]

        guard dates.count < entryLimit else {
            return dates
        }

        func append(_ date: Int64) {
            if dates.count < entryLimit, date > dates[dates.count - 1] {
                dates.append(date)
            }
        }

        for minute in Int64(1)...59 {
            let (offset, offsetOverflow) = minute.multipliedReportingOverflow(
                by: minuteMilliseconds
            )
            let (minuteDate, dateOverflow) = balancesAt.addingReportingOverflow(offset)

            if !offsetOverflow, !dateOverflow, minuteDate > now {
                append(minuteDate)
            }

            if minute == 15 {
                let (amberDate, amberOverflow) = minuteDate.addingReportingOverflow(1)
                if !dateOverflow, !amberOverflow, amberDate > now {
                    append(amberDate)
                }
            }

            if dates.count == entryLimit {
                return dates
            }
        }

        var hour = firstHour(after: now, balancesAt: balancesAt)
        while dates.count < entryLimit {
            let (offset, offsetOverflow) = hour.multipliedReportingOverflow(
                by: hourMilliseconds
            )
            let (hourDate, dateOverflow) = balancesAt.addingReportingOverflow(offset)
            guard !offsetOverflow, !dateOverflow else {
                return dates
            }

            append(hourDate)
            let (nextHour, hourOverflow) = hour.addingReportingOverflow(1)
            guard !hourOverflow else {
                return dates
            }
            hour = nextHour
        }

        return dates
    }

    static func relevanceScore(requestWaiting: Bool) -> Float {
        requestWaiting ? 100 : 1
    }

    private static func firstHour(after now: Int64, balancesAt: Int64) -> Int64 {
        guard now >= balancesAt else {
            return 1
        }

        let nowParts = floorDivision(now, by: hourMilliseconds)
        let balanceParts = floorDivision(balancesAt, by: hourMilliseconds)
        let completedHours = nowParts.quotient - balanceParts.quotient
            - (nowParts.remainder < balanceParts.remainder ? 1 : 0)
        return max(1, completedHours + 1)
    }

    private static func floorDivision(
        _ value: Int64,
        by divisor: Int64
    ) -> (quotient: Int64, remainder: Int64) {
        var quotient = value / divisor
        var remainder = value % divisor
        if remainder < 0 {
            quotient -= 1
            remainder += divisor
        }
        return (quotient, remainder)
    }
}
