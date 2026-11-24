import Foundation
import CryptoKit

struct WatchDetailFile: Equatable {
    let tokenId: String
    let hash: String
    let data: Data
}

enum WatchPluginArgs {
    static func snapshotContext(json: String?) -> [String: Any]? {
        validatedContext(json: json)?.context
    }

    static func detailFile(json: String?) -> WatchDetailFile? {
        guard let validated = validatedContext(json: json),
              let tokenId = validated.context["tokenId"] as? String,
              !tokenId.isEmpty else {
            return nil
        }

        let digest = SHA256.hash(data: validated.data)
        let hash = digest.map { String(format: "%02x", $0) }.joined()

        return WatchDetailFile(tokenId: tokenId, hash: hash, data: validated.data)
    }

    private static func validatedContext(
        json: String?
    ) -> (context: [String: Any], data: Data)? {
        guard let json,
              !json.isEmpty,
              let data = json.data(using: .utf8),
              let context = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let version = context["v"] as? NSNumber,
              CFGetTypeID(version) != CFBooleanGetTypeID(),
              version.compare(NSNumber(value: 1)) == .orderedSame,
              !containsNull(context) else {
            return nil
        }

        return (context, data)
    }

    private static func containsNull(_ value: Any) -> Bool {
        if value is NSNull {
            return true
        }
        if let dictionary = value as? [String: Any] {
            return dictionary.values.contains(where: containsNull)
        }
        if let array = value as? [Any] {
            return array.contains(where: containsNull)
        }
        return false
    }
}
