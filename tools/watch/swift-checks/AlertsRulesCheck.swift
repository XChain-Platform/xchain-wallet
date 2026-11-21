import Foundation

@main
struct AlertsRulesCheck {
    private struct Item: Equatable {
        let id: String
        let at: Int64
    }

    static func main() {
        let shuffledValues = [
            7, 24, 3, 19, 0, 14, 22, 5, 11, 1, 18, 9, 23,
            4, 16, 2, 20, 12, 6, 17, 8, 21, 10, 15, 13,
        ]
        let shuffled = shuffledValues.map { Item(id: String($0), at: Int64($0)) }
        let newest = AlertsRules.newestFirst(shuffled, at: { $0.at })
        check(
            newest.map(\.at) == Array(stride(from: Int64(24), through: 5, by: -1)),
            "newestFirst sorts 25 shuffled items and limits the result to 20"
        )

        let tied = [
            Item(id: "first", at: 10),
            Item(id: "older", at: 9),
            Item(id: "second", at: 10),
        ]
        check(
            AlertsRules.newestFirst(tied, at: { $0.at }).map(\.id) == ["first", "second", "older"],
            "newestFirst preserves input order for equal timestamps"
        )
        check(
            AlertsRules.newestFirst([Item](), at: { $0.at }).isEmpty,
            "newestFirst handles an empty list"
        )

        check(!AlertsRules.hasUnread([true, true]), "hasUnread reports no unread items")
        check(AlertsRules.hasUnread([true, false, true]), "hasUnread reports one unread item")
        check(AlertsRules.hasUnread([false, false]), "hasUnread reports all unread items")

        check(AlertsRules.emptyTextKey(count: 0) == "w3.empty", "emptyTextKey returns the empty key")
        check(AlertsRules.emptyTextKey(count: 1) == nil, "emptyTextKey omits the key for a nonempty list")

        check(AlertsRules.detailBody("") == nil, "detailBody omits an empty body")
        check(AlertsRules.detailBody("  \n") == nil, "detailBody omits a whitespace-only body")
        check(AlertsRules.detailBody(" Sent ") == " Sent ", "detailBody preserves a nonempty body")

        let now: Int64 = 1_000
        check(!AlertsRules.isExpired(expiresAt: nil, now: now), "isExpired accepts a missing expiry")
        check(!AlertsRules.isExpired(expiresAt: now + 1, now: now), "isExpired accepts a future expiry")
        check(AlertsRules.isExpired(expiresAt: now, now: now), "isExpired rejects an expiry at now")
        check(AlertsRules.isExpired(expiresAt: now - 1, now: now), "isExpired rejects a past expiry")
    }

    private static func check(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else {
            FileHandle.standardError.write(Data("FAIL: \(name)\n".utf8))
            exit(1)
        }
    }
}
