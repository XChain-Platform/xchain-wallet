import Foundation

enum PhoneIntentMessage {
    static let kinds = [
        "refresh",
        "detailRequest",
        "openOnPhone",
        "markRead",
        "watchState",
    ]

    static func message<T: Encodable>(kind: String, value: T) -> [String: Any]? {
        guard kinds.contains(kind),
              let data = try? JSONEncoder().encode(value),
              let object = try? JSONSerialization.jsonObject(with: data),
              let value = object as? [String: Any] else {
            return nil
        }

        return ["kind": kind, "value": value]
    }
}
