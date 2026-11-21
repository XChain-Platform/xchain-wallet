import Foundation

@main
struct NotifyScheduleRulesCheck {
    static func main() {
        check(NotifyScheduleRules.timeInterval(atMs: 3_600_000, nowMs: 0) == 3_600,
              "one hour ahead")
        check(NotifyScheduleRules.timeInterval(atMs: 1_000, nowMs: 1_000) == 1,
              "exactly now")
        check(NotifyScheduleRules.timeInterval(atMs: 0, nowMs: 60_000) == 1,
              "one minute past")
        check(NotifyScheduleRules.timeInterval(atMs: 1_500, nowMs: 0) == 1.5,
              "1500 milliseconds ahead")

        let fortySeven = Set((0..<47).map { "pending-\($0)" })
        let fortyEight = Set((0..<48).map { "pending-\($0)" })
        check(NotifyScheduleRules.admits(pendingIds: fortySeven, id: "new"),
              "47 pending admit a new id")
        check(!NotifyScheduleRules.admits(pendingIds: fortyEight, id: "new"),
              "48 pending refuse a new id")
        check(NotifyScheduleRules.admits(pendingIds: fortyEight, id: "pending-0"),
              "48 pending admit an existing id")
        check(!NotifyScheduleRules.admits(pendingIds: fortySeven, id: ""),
              "empty id is refused")
    }

    private static func check(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else {
            print("FAILED: \(name)")
            exit(1)
        }
    }
}
