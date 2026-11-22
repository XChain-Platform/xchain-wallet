import Foundation

enum WatchIntentMessage {
    static let kinds = [
        "refresh",
        "detailRequest",
        "openOnPhone",
        "markRead",
        "watchState",
    ]

    static func read(_ message: [String: Any]) -> (kind: String, value: [String: Any])? {
        guard Set(message.keys) == Set(["kind", "value"]),
              let kind = message["kind"] as? String,
              kinds.contains(kind),
              let value = message["value"] as? [String: Any] else {
            return nil
        }

        return (kind, value)
    }
}
