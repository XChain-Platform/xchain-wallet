import Foundation

enum WatchFileMetadata {
    static let kinds = ["detail", "image"]

    static func metadata(kind: String, key: String) -> [String: String]? {
        guard kinds.contains(kind),
              !key.isEmpty,
              kind != "image" || isImageHash(key) else {
            return nil
        }

        return ["kind": kind, "key": key]
    }

    private static func isImageHash(_ key: String) -> Bool {
        key.utf8.count == 64 && key.utf8.allSatisfy { byte in
            (byte >= 48 && byte <= 57) || (byte >= 97 && byte <= 102)
        }
    }
}
