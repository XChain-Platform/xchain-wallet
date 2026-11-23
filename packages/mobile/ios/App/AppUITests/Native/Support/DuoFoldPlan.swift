import Foundation

enum DuoFoldPlan {
    static let states = [
        "closed-portrait",
        "closed-landscape",
        "open-portrait",
        "open-landscape",
        "partial-vertical",
        "partial-horizontal",
    ]

    struct Division: Equatable {
        let orientation: String
        let x: Double
        let y: Double
        let width: Double
        let height: Double
    }

    enum Entry: Equatable {
        case measured(name: String, width: Double, height: Double, division: Division)
        case unreachable(name: String, reason: String)
    }

    struct Capture: Equatable {
        let fields: [String: String]
        let scrollTop: Double
        let confirmOpen: Bool
        let detailKey: String?
    }

    static func entries(_ data: Data) -> [Entry]? {
        guard
            let value = try? JSONSerialization.jsonObject(with: data),
            let document = value as? [String: Any],
            let stateValues = document["states"] as? [String: Any],
            Set(stateValues.keys) == Set(states)
        else {
            return nil
        }

        var result: [Entry] = []
        for name in states {
            guard let state = stateValues[name] as? [String: Any] else {
                return nil
            }

            if Set(state.keys) == ["unreachable"] {
                guard
                    let reason = state["unreachable"] as? String,
                    !reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                else {
                    return nil
                }
                result.append(.unreachable(name: name, reason: reason))
                continue
            }

            guard
                Set(state.keys) == ["width", "height", "division"],
                let width = number(state["width"], positive: true),
                let height = number(state["height"], positive: true),
                let divisionValue = state["division"] as? [String: Any],
                Set(divisionValue.keys) == ["orientation", "x", "y", "width", "height"],
                let orientation = divisionValue["orientation"] as? String,
                ["vertical", "horizontal", "none"].contains(orientation),
                let x = number(divisionValue["x"]),
                let y = number(divisionValue["y"]),
                let divisionWidth = number(divisionValue["width"]),
                let divisionHeight = number(divisionValue["height"])
            else {
                return nil
            }

            result.append(
                .measured(
                    name: name,
                    width: width,
                    height: height,
                    division: Division(
                        orientation: orientation,
                        x: x,
                        y: y,
                        width: divisionWidth,
                        height: divisionHeight
                    )
                )
            )
        }
        return result
    }

    static func dividerOnFold(
        dividerX: Double,
        division: Division,
        tolerance: Double
    ) -> Bool {
        division.orientation == "vertical"
            && dividerX.isFinite
            && division.x.isFinite
            && division.y.isFinite
            && division.width.isFinite
            && division.height.isFinite
            && tolerance.isFinite
            && tolerance >= 0
            && abs(dividerX - division.x) <= tolerance
    }

    static func survivalFailures(
        before: Capture,
        after: Capture,
        scrollTolerance: Double = 2
    ) -> [String] {
        var failures = before.fields.keys.sorted().compactMap { name in
            after.fields[name] == before.fields[name] ? nil : "field:\(name)"
        }
        if abs(after.scrollTop - before.scrollTop) > scrollTolerance {
            failures.append("scroll")
        }
        if before.confirmOpen && !after.confirmOpen {
            failures.append("confirm")
        }
        if before.detailKey != after.detailKey {
            failures.append("detail")
        }
        return failures
    }

    private static func number(_ value: Any?, positive: Bool = false) -> Double? {
        guard
            let value,
            let number = value as? NSNumber,
            CFGetTypeID(number) != CFBooleanGetTypeID()
        else {
            return nil
        }
        let result = number.doubleValue
        guard result.isFinite, positive ? result > 0 : result >= 0 else {
            return nil
        }
        return result
    }
}
