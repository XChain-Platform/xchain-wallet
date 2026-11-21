import Foundation

enum NotifyScheduleRules {
    static let maxPending = 48

    static func timeInterval(atMs: Int64, nowMs: Int64) -> TimeInterval {
        max(Double(atMs - nowMs) / 1_000, 1)
    }

    static func admits(pendingIds: Set<String>, id: String) -> Bool {
        guard !id.isEmpty else { return false }
        return pendingIds.contains(id) || pendingIds.count < maxPending
    }
}
