import Foundation

@main
struct DuoFoldPlanCheck {
    static func main() {
        let entries = DuoFoldPlan.entries(document())
        require(entries?.count == 6, "valid document count")
        require(entries?.map(entryName) == DuoFoldPlan.states, "state order")

        let bookDivision = DuoFoldPlan.Division(
            orientation: "vertical",
            x: 475.5,
            y: 0,
            width: 0,
            height: 669
        )
        require(
            entries?[2] == .measured(
                name: "open-portrait",
                width: 951,
                height: 669,
                division: bookDivision
            ),
            "Book pose measurement"
        )
        require(
            entries?[0] == .measured(
                name: "closed-portrait",
                width: 720,
                height: 1280,
                division: .init(orientation: "none", x: 0, y: 0, width: 0, height: 0)
            ),
            "closed pose measurement"
        )
        require(
            entries?[5] == .unreachable(
                name: "partial-horizontal",
                reason: "hinge does not expose this posture"
            ),
            "unreachable state"
        )

        require(DuoFoldPlan.entries(Data("not JSON".utf8)) == nil, "non-JSON refusal")
        require(DuoFoldPlan.entries(Data("[]".utf8)) == nil, "top-level array refusal")
        require(DuoFoldPlan.entries(document(omitting: "open-landscape")) == nil, "missing state refusal")
        require(DuoFoldPlan.entries(document(extra: true)) == nil, "extra state refusal")
        require(
            refused("closed-portrait", "{\"unreachable\":\"no pose\",\"width\":720}"),
            "mixed unreachable refusal"
        )
        require(refused("closed-portrait", "{\"unreachable\":\" \\n \\t\"}"), "blank reason refusal")
        require(refused("closed-portrait", measured(width: "0")), "zero width refusal")
        require(refused("closed-portrait", measured(x: "-1")), "negative division x refusal")
        require(refused("closed-portrait", measured(width: "true")), "boolean width refusal")
        require(refused("closed-portrait", measured(orientation: "diagonal")), "orientation refusal")
        require(refused("closed-portrait", measured(includeY: false)), "missing division y refusal")

        require(DuoFoldPlan.dividerOnFold(dividerX: 475.5, division: bookDivision, tolerance: 1), "exact divider")
        require(
            DuoFoldPlan.dividerOnFold(dividerX: 476.4, division: bookDivision, tolerance: 1),
            "divider within tolerance"
        )
        require(
            !DuoFoldPlan.dividerOnFold(dividerX: 476.6, division: bookDivision, tolerance: 1),
            "divider past tolerance"
        )
        require(
            !DuoFoldPlan.dividerOnFold(
                dividerX: 475.5,
                division: .init(orientation: "horizontal", x: 475.5, y: 0, width: 0, height: 669),
                tolerance: 1
            ),
            "horizontal division refusal"
        )
        require(!DuoFoldPlan.dividerOnFold(dividerX: .nan, division: bookDivision, tolerance: 1), "NaN divider refusal")
        require(
            !DuoFoldPlan.dividerOnFold(dividerX: 475.5, division: bookDivision, tolerance: -1),
            "negative tolerance refusal"
        )
        require(
            DuoFoldPlan.dividerOnFold(dividerX: 475.5, division: bookDivision, tolerance: 0),
            "zero tolerance exact divider"
        )

        let base = DuoFoldPlan.Capture(
            fields: ["a": "one", "b": "two"],
            scrollTop: 10,
            confirmOpen: true,
            detailKey: nil
        )
        require(DuoFoldPlan.survivalFailures(before: base, after: base).isEmpty, "equal captures")
        require(
            DuoFoldPlan.survivalFailures(
                before: base,
                after: .init(
                    fields: ["b": "changed"],
                    scrollTop: 10,
                    confirmOpen: true,
                    detailKey: nil
                )
            ) == ["field:a", "field:b"],
            "field failures"
        )
        require(
            DuoFoldPlan.survivalFailures(
                before: base,
                after: capture(from: base, scrollTop: 12)
            ).isEmpty,
            "scroll at tolerance"
        )
        require(
            DuoFoldPlan.survivalFailures(
                before: base,
                after: capture(from: base, scrollTop: 12.5)
            ) == ["scroll"],
            "scroll past tolerance"
        )
        require(
            DuoFoldPlan.survivalFailures(
                before: base,
                after: capture(from: base, confirmOpen: false)
            ) == ["confirm"],
            "confirm closure"
        )
        require(
            DuoFoldPlan.survivalFailures(
                before: capture(from: base, confirmOpen: false),
                after: base
            ).isEmpty,
            "confirm opening survives"
        )
        require(
            DuoFoldPlan.survivalFailures(
                before: base,
                after: capture(from: base, detailKey: "asset")
            ) == ["detail"],
            "detail change"
        )
        require(
            DuoFoldPlan.survivalFailures(
                before: base,
                after: .init(
                    fields: ["a": "changed", "b": "two"],
                    scrollTop: 12.5,
                    confirmOpen: false,
                    detailKey: "asset"
                )
            ) == ["field:a", "scroll", "confirm", "detail"],
            "combined failure order"
        )
    }

    private static func entryName(_ entry: DuoFoldPlan.Entry) -> String {
        switch entry {
        case let .measured(name, _, _, _), let .unreachable(name, _):
            return name
        }
    }

    private static func refused(_ name: String, _ state: String) -> Bool {
        DuoFoldPlan.entries(document(overrides: [name: state])) == nil
    }

    private static func document(
        overrides: [String: String] = [:],
        omitting omittedName: String? = nil,
        extra: Bool = false
    ) -> Data {
        let defaults = [
            "closed-portrait": measured(width: "720", height: "1280", orientation: "none", x: "0", divisionHeight: "0"),
            "closed-landscape": measured(
                width: "1280",
                height: "720",
                orientation: "none",
                x: "0",
                divisionHeight: "0"
            ),
            "open-portrait": measured(width: "951", height: "669", x: "475.5", divisionHeight: "669"),
            "open-landscape": measured(
                width: "669",
                height: "951",
                orientation: "horizontal",
                y: "475.5",
                divisionWidth: "669",
                divisionHeight: "0"
            ),
            "partial-vertical": measured(width: "900", height: "700", x: "450", divisionHeight: "700"),
            "partial-horizontal": "{\"unreachable\":\"hinge does not expose this posture\"}",
        ]
        var pairs = DuoFoldPlan.states.compactMap { name -> String? in
            guard name != omittedName, let state = overrides[name] ?? defaults[name] else {
                return nil
            }
            return "\"\(name)\":\(state)"
        }
        if extra {
            pairs.append("\"extra\":\(measured())")
        }
        return Data("{\"device\":\"Surface Duo\",\"states\":{\(pairs.joined(separator: ","))}}".utf8)
    }

    private static func measured(
        width: String = "100",
        height: String = "200",
        orientation: String = "vertical",
        x: String = "50",
        y: String = "0",
        divisionWidth: String = "0",
        divisionHeight: String = "200",
        includeY: Bool = true
    ) -> String {
        let yMember = includeY ? ",\"y\":\(y)" : ""
        return "{\"width\":\(width),\"height\":\(height),\"division\":"
            + "{\"orientation\":\"\(orientation)\",\"x\":\(x)\(yMember),"
            + "\"width\":\(divisionWidth),\"height\":\(divisionHeight)}}"
    }

    private static func capture(
        from source: DuoFoldPlan.Capture,
        scrollTop: Double? = nil,
        confirmOpen: Bool? = nil,
        detailKey: String?? = nil
    ) -> DuoFoldPlan.Capture {
        DuoFoldPlan.Capture(
            fields: source.fields,
            scrollTop: scrollTop ?? source.scrollTop,
            confirmOpen: confirmOpen ?? source.confirmOpen,
            detailKey: detailKey ?? source.detailKey
        )
    }

    private static func require(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else {
            FileHandle.standardError.write(Data("DuoFoldPlanCheck failed: \(name)\n".utf8))
            exit(1)
        }
    }
}
