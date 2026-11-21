import Foundation

@main
struct FoldPayloadCheck {
    static func main() {
        let expectedLine = "fold: {\"display\":\"inner\",\"division\":{\"height\":669,\"orientation\":\"vertical\",\"width\":0,\"x\":475.5,\"y\":0},\"posture\":\"open\",\"viewport\":{\"height\":669,\"width\":951}}"
        check(
            FoldPayload.line(
                posture: "open",
                orientation: "vertical",
                x: 475.5,
                y: 0,
                width: 0,
                height: 669,
                display: "inner",
                viewportWidth: 951,
                viewportHeight: 669
            ) == expectedLine,
            "open Book pose line"
        )

        let expectedClosed = "{\"display\":\"outer\",\"division\":{\"height\":0,\"orientation\":\"none\",\"width\":0,\"x\":0,\"y\":0},\"posture\":\"closed\"}"
        check(
            FoldPayload.json(
                posture: "closed",
                orientation: "none",
                x: 0,
                y: 0,
                width: 0,
                height: 0,
                display: "outer"
            ) == expectedClosed,
            "closed pose JSON"
        )

        check(refused(posture: "flat"), "invalid posture refusal")
        check(refused(orientation: "diagonal"), "invalid orientation refusal")
        check(refused(display: "both"), "invalid display refusal")
        check(refused(x: -1), "negative number refusal")
        check(refused(y: .infinity), "non-finite number refusal")
        check(lineRefused(viewportWidth: 0), "non-positive viewport width refusal")
        check(lineRefused(viewportHeight: -1), "non-positive viewport height refusal")
        check(lineRefused(viewportWidth: .nan), "non-finite viewport refusal")
    }

    private static func refused(
        posture: String = "partial",
        orientation: String = "horizontal",
        x: Double = 1,
        y: Double = 2,
        width: Double = 3,
        height: Double = 4,
        display: String = "inner",
        viewportWidth: Double = 100,
        viewportHeight: Double = 200
    ) -> Bool {
        FoldPayload.json(
            posture: posture,
            orientation: orientation,
            x: x,
            y: y,
            width: width,
            height: height,
            display: display
        ) == nil && FoldPayload.line(
            posture: posture,
            orientation: orientation,
            x: x,
            y: y,
            width: width,
            height: height,
            display: display,
            viewportWidth: viewportWidth,
            viewportHeight: viewportHeight
        ) == nil
    }

    private static func lineRefused(
        viewportWidth: Double = 100,
        viewportHeight: Double = 200
    ) -> Bool {
        FoldPayload.line(
            posture: "partial",
            orientation: "horizontal",
            x: 1,
            y: 2,
            width: 3,
            height: 4,
            display: "inner",
            viewportWidth: viewportWidth,
            viewportHeight: viewportHeight
        ) == nil
    }

    private static func check(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else {
            fputs("FoldPayloadCheck failed: \(name)\n", stderr)
            exit(1)
        }
    }
}
