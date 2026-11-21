import Foundation

enum ActivityCheckResponse {
    static func strings(
        from data: Data,
        confirmedPath: String,
        pendingPath: String
    ) -> [String]? {
        guard
            let object = try? JSONSerialization.jsonObject(with: data),
            let root = object as? [String: Any],
            let confirmed = string(at: confirmedPath, in: root),
            let pending = string(at: pendingPath, in: root)
        else {
            return nil
        }

        return [confirmed, pending]
    }

    private static func string(at path: String, in root: [String: Any]) -> String? {
        let segments = path.split(separator: ".", omittingEmptySubsequences: false)
        guard !segments.isEmpty else {
            return nil
        }

        var value: Any = root
        for segment in segments {
            guard
                !segment.isEmpty,
                let object = value as? [String: Any],
                let next = object[String(segment)]
            else {
                return nil
            }
            value = next
        }

        return value as? String
    }
}
