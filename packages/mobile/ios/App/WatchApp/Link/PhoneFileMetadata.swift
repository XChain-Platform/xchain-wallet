import Foundation

enum PhoneFileKind: String, CaseIterable {
    case detail
    case image
}

enum PhoneFileMetadata {
    static func read(_ metadata: [String: Any]?) -> (kind: PhoneFileKind, key: String)? {
        guard let metadata,
              Set(metadata.keys) == Set(["kind", "key"]),
              let rawKind = metadata["kind"] as? String,
              let kind = PhoneFileKind(rawValue: rawKind),
              let key = metadata["key"] as? String,
              !key.isEmpty,
              kind != .image || isImageHash(key) else {
            return nil
        }

        return (kind, key)
    }

    private static func isImageHash(_ key: String) -> Bool {
        key.utf8.count == 64 && key.utf8.allSatisfy { byte in
            (byte >= 48 && byte <= 57) || (byte >= 97 && byte <= 102)
        }
    }
}
