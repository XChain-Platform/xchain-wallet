import Foundation

enum FoldScript {
    static let globalName = "__xchainNativeFold"
    static let eventName = "xchain:native-fold"

    static func bootstrapScript(json: String?) -> String? {
        guard let json, isJSONObject(json) else {
            return nil
        }

        return assignment(json: json)
    }

    static func publishScript(json: String?) -> String? {
        guard let json, isJSONObject(json) else {
            return nil
        }

        return """
        \(assignment(json: json))
        window.dispatchEvent(new CustomEvent('\(eventName)', { detail: window.\(globalName) }));
        """
    }

    private static func assignment(json: String) -> String {
        "window.\(globalName) = \(json);"
    }

    private static func isJSONObject(_ json: String) -> Bool {
        guard !json.isEmpty,
              let data = json.data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data),
              value is [String: Any] else {
            return false
        }

        return true
    }
}
