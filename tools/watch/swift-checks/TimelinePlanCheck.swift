import Foundation

@main
struct TimelinePlanCheck {
    static func main() {
        let minute: Int64 = 60_000
        let hour: Int64 = 60 * minute

        let fresh = TimelinePlan.entryDates(balancesAt: 0, now: 0)
        require(fresh.count == 60, "fresh count")
        require(fresh.first == 0, "fresh now first")
        require(fresh.dropFirst().first == minute, "fresh minute second")
        require(
            adjacentPair(15 * minute, 15 * minute + 1, in: fresh),
            "fresh amber boundary"
        )
        require(fresh.last == 58 * minute, "fresh minute 58 last")

        let halfHourNow = 30 * minute + 1
        let halfHour = TimelinePlan.entryDates(balancesAt: 0, now: halfHourNow)
        require(
            halfHour.dropFirst().allSatisfy { $0 > halfHourNow },
            "half-hour future entries"
        )
        require(!halfHour.contains(15 * minute + 1), "half-hour no amber")
        require(
            adjacentPair(59 * minute, hour, in: halfHour),
            "half-hour minute 59 then hour 1"
        )
        require(halfHour.filter { $0 == hour }.count == 1, "half-hour hour 1 once")

        let threeDays = TimelinePlan.entryDates(balancesAt: 0, now: 72 * hour)
        require(threeDays.first == 72 * hour, "three-day now first")
        require(threeDays.dropFirst().first == 73 * hour, "three-day hour 73 second")

        let futureBalance = TimelinePlan.entryDates(balancesAt: minute, now: 0)
        require(futureBalance.first == 0, "future balance now first")
        require(futureBalance.dropFirst().first == 2 * minute, "future balance minute 1")

        require(
            TimelinePlan.entryDates(balancesAt: 0, now: 0, limit: 1) == [0],
            "limit 1"
        )
        require(
            TimelinePlan.entryDates(balancesAt: 0, now: 0, limit: 0) == [0],
            "limit 0"
        )

        let lists = [fresh, halfHour, threeDays, futureBalance]
        require(lists.allSatisfy(isStrictlyAscending), "strictly ascending")
        require(
            TimelinePlan.relevanceScore(requestWaiting: true) == 100,
            "waiting relevance"
        )
        require(
            TimelinePlan.relevanceScore(requestWaiting: false) == 1,
            "idle relevance"
        )
    }

    private static func adjacentPair(_ first: Int64, _ second: Int64, in values: [Int64]) -> Bool {
        values.indices.dropLast().contains { index in
            values[index] == first && values[index + 1] == second
        }
    }

    private static func isStrictlyAscending(_ values: [Int64]) -> Bool {
        values.indices.dropLast().allSatisfy { index in
            values[index] < values[index + 1]
        }
    }

    private static func require(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else {
            FileHandle.standardError.write(Data("FAIL: \(name)\n".utf8))
            exit(1)
        }
    }
}
