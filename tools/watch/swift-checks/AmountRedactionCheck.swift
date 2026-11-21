import Foundation

@main
struct AmountRedactionCheck {
    static func main() {
        let redactionCases = [
            (false, false, false, false),
            (false, false, true, true),
            (false, true, false, true),
            (false, true, true, true),
            (true, false, false, true),
            (true, false, true, true),
            (true, true, false, true),
            (true, true, true, true),
        ]

        for (luminanceReduced, phoneHidden, hideAmounts, expected) in redactionCases {
            let actual = AmountRedaction.isRedacted(
                luminanceReduced: luminanceReduced,
                phoneHidden: phoneHidden,
                hideAmounts: hideAmounts
            )
            require(
                actual == expected,
                "isRedacted(\(luminanceReduced), \(phoneHidden), \(hideAmounts))"
            )
        }

        require(
            AmountRedaction.showsPriceLine(redacted: false, noPrice: false, pointCount: 2),
            "showsPriceLine displays two points"
        )
        require(
            AmountRedaction.showsPriceLine(redacted: false, noPrice: false, pointCount: 48),
            "showsPriceLine displays 48 points"
        )
        require(
            !AmountRedaction.showsPriceLine(redacted: false, noPrice: false, pointCount: 0),
            "showsPriceLine hides zero points"
        )
        require(
            !AmountRedaction.showsPriceLine(redacted: false, noPrice: false, pointCount: 1),
            "showsPriceLine hides one point"
        )
        require(
            !AmountRedaction.showsPriceLine(redacted: true, noPrice: false, pointCount: 2),
            "showsPriceLine hides redacted two points"
        )
        require(
            !AmountRedaction.showsPriceLine(redacted: true, noPrice: false, pointCount: 48),
            "showsPriceLine hides redacted 48 points"
        )
        require(
            !AmountRedaction.showsPriceLine(redacted: false, noPrice: true, pointCount: 2),
            "showsPriceLine hides unpriced two points"
        )
        require(
            !AmountRedaction.showsPriceLine(redacted: false, noPrice: true, pointCount: 48),
            "showsPriceLine hides unpriced 48 points"
        )
    }

    private static func require(_ condition: Bool, _ caseName: String) {
        guard condition else {
            FileHandle.standardError.write(Data("FAILED: \(caseName)\n".utf8))
            exit(1)
        }
    }
}
