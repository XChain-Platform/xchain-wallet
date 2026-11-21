import Foundation

enum AlertsRules {
    static let listLimit = 20

    static func newestFirst<T>(_ items: [T], at: (T) -> Int64) -> [T] {
        let sortedItems = items.enumerated().sorted { left, right in
            let leftAt = at(left.element)
            let rightAt = at(right.element)

            if leftAt == rightAt {
                return left.offset < right.offset
            }

            return leftAt > rightAt
        }

        return sortedItems.prefix(listLimit).map(\.element)
    }

    static func hasUnread(_ reads: [Bool]) -> Bool {
        reads.contains(false)
    }

    static func emptyTextKey(count: Int) -> String? {
        count == 0 ? "w3.empty" : nil
    }

    static func detailBody(_ body: String) -> String? {
        body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : body
    }

    static func isExpired(expiresAt: Int64?, now: Int64) -> Bool {
        guard let expiresAt else {
            return false
        }

        return expiresAt <= now
    }
}
