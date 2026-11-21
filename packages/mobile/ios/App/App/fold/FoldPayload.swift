import Foundation

enum FoldPayload {
    static func json(
        posture: String,
        orientation: String,
        x: Double,
        y: Double,
        width: Double,
        height: Double,
        display: String
    ) -> String? {
        serializedPayload(
            posture: posture,
            orientation: orientation,
            x: x,
            y: y,
            width: width,
            height: height,
            display: display,
            viewport: nil
        )
    }

    static func line(
        posture: String,
        orientation: String,
        x: Double,
        y: Double,
        width: Double,
        height: Double,
        display: String,
        viewportWidth: Double,
        viewportHeight: Double
    ) -> String? {
        guard viewportWidth.isFinite,
              viewportHeight.isFinite,
              viewportWidth > 0,
              viewportHeight > 0 else {
            return nil
        }

        guard let payload = serializedPayload(
            posture: posture,
            orientation: orientation,
            x: x,
            y: y,
            width: width,
            height: height,
            display: display,
            viewport: [
                "width": viewportWidth,
                "height": viewportHeight,
            ]
        ) else {
            return nil
        }

        return "fold: \(payload)"
    }

    private static func serializedPayload(
        posture: String,
        orientation: String,
        x: Double,
        y: Double,
        width: Double,
        height: Double,
        display: String,
        viewport: [String: Double]?
    ) -> String? {
        guard ["closed", "open", "partial"].contains(posture),
              ["vertical", "horizontal", "none"].contains(orientation),
              ["inner", "outer"].contains(display) else {
            return nil
        }

        let numbers = [x, y, width, height]
        guard numbers.allSatisfy({ $0.isFinite && $0 >= 0 }) else {
            return nil
        }

        var payload: [String: Any] = [
            "posture": posture,
            "division": [
                "orientation": orientation,
                "x": x,
                "y": y,
                "width": width,
                "height": height,
            ],
            "display": display,
        ]
        if let viewport {
            payload["viewport"] = viewport
        }

        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) else {
            return nil
        }

        return String(data: data, encoding: .utf8)
    }
}
