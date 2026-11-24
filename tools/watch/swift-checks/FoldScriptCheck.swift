import Foundation

@main
struct FoldScriptCheck {
    static func main() {
        check(FoldScript.globalName == "__xchainNativeFold", "global name")
        check(FoldScript.eventName == "xchain:native-fold", "event name")

        let closedJSON = FoldPayload.json(
            posture: "closed",
            orientation: "none",
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            display: "outer"
        )
        let expectedClosedJSON = "{\"display\":\"outer\",\"division\":{\"height\":0,\"orientation\":\"none\",\"width\":0,\"x\":0,\"y\":0},\"posture\":\"closed\"}"
        check(closedJSON == expectedClosedJSON, "closed outer payload")
        check(
            FoldScript.bootstrapScript(json: closedJSON)
                == "window.__xchainNativeFold = \(expectedClosedJSON);",
            "closed outer bootstrap script"
        )
        check(
            FoldScript.publishScript(json: closedJSON)
                == "window.__xchainNativeFold = \(expectedClosedJSON);\nwindow.dispatchEvent(new CustomEvent('xchain:native-fold', { detail: window.__xchainNativeFold }));",
            "closed outer publish script"
        )

        let openJSON = FoldPayload.json(
            posture: "open",
            orientation: "vertical",
            x: 475.5,
            y: 0,
            width: 0,
            height: 669,
            display: "inner"
        )
        guard let openJSON, let openScript = FoldScript.publishScript(json: openJSON) else {
            fail("open Book publish script")
        }
        check(openScript.components(separatedBy: openJSON).count == 2, "open Book JSON written once")
        guard let assignmentRange = openScript.range(of: "window.__xchainNativeFold = "),
              let dispatchRange = openScript.range(of: "window.dispatchEvent") else {
            fail("open Book script statements")
        }
        check(assignmentRange.lowerBound < dispatchRange.lowerBound, "assignment before dispatch")

        let refusedInputs: [(String?, String)] = [
            (nil, "nil"),
            ("", "empty string"),
            ("not json", "invalid JSON"),
            ("[1]", "array"),
            ("1", "number"),
            ("\"string\"", "string"),
            ("{\"a\":1}; alert(1)", "trailing JavaScript"),
        ]
        for (input, name) in refusedInputs {
            check(FoldScript.bootstrapScript(json: input) == nil, "\(name) bootstrap refusal")
            check(FoldScript.publishScript(json: input) == nil, "\(name) publish refusal")
        }
    }

    private static func check(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else {
            fail(name)
        }
    }

    private static func fail(_ name: String) -> Never {
        fputs("FoldScriptCheck failed: \(name)\n", stderr)
        exit(1)
    }
}
