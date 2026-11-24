import Foundation

@main
struct WidgetFramesCheck {
    static func main() {
        let minute: Int64 = 60_000
        let day: Int64 = 24 * 60 * minute
        let now: Int64 = 10 * day

        let unread = WidgetSummaryContent(
            unreadCount: 3, requestWaiting: false, totalText: nil, balancesAt: now
        )
        let a = WidgetFrames.frames(summary: unread, now: now)
        require(a.count == 60, "unread count")
        require(
            a.map { $0.at } == TimelinePlan.entryDates(balancesAt: now, now: now),
            "unread dates match plan"
        )
        require(a[0].at == now, "unread first at now")
        require(a[0].badge == .unread(3), "unread badge")
        require(a[0].headline == .alerts(3), "unread headline")
        require(a[0].age == WidgetFrames.Age(key: "state.ageJustNow", n: 0), "unread first age")
        require(a[0].relevance == 1, "unread relevance")
        require(a[1].age == WidgetFrames.Age(key: "state.ageMinutes", n: 1), "unread second age")

        let waiting = WidgetSummaryContent(
            unreadCount: 0, requestWaiting: true, totalText: "$1,234.56",
            balancesAt: now - 30 * minute - 1
        )
        let b = WidgetFrames.frames(summary: waiting, now: now)
        require(!b.isEmpty, "waiting frames")
        require(
            b.allSatisfy {
                $0.badge == .request && $0.headline == .total("$1,234.56") && $0.relevance == 100
            },
            "waiting shared fields"
        )
        require(b[0].age == WidgetFrames.Age(key: "state.ageMinutes", n: 30), "waiting first age")

        let stale = WidgetSummaryContent(
            unreadCount: 0, requestWaiting: false, totalText: nil, balancesAt: now - 3 * day
        )
        let c = WidgetFrames.frames(summary: stale, now: now)
        require(c[0].age == WidgetFrames.Age(key: "state.stale24h", n: 0), "stale first age")

        let none = WidgetSummaryContent(
            unreadCount: 0, requestWaiting: false, totalText: nil, balancesAt: nil
        )
        let d = WidgetFrames.frames(summary: none, now: now)
        require(d.count == 1, "nil balancesAt one frame")
        require(d[0].at == now, "nil balancesAt at now")
        require(d[0].age == nil, "nil balancesAt nil age")

        require(WidgetFrames.frames(summary: unread, now: now, limit: 1).count == 1, "limit 1")

        print("WidgetFramesCheck passed")
    }

    static func require(_ condition: Bool, _ name: String) {
        if !condition {
            FileHandle.standardError.write(Data("FAIL: \(name)\n".utf8))
            exit(1)
        }
    }
}
