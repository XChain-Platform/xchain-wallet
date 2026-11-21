import Foundation

enum AmountRedaction {
    static func isRedacted(
        luminanceReduced: Bool,
        phoneHidden: Bool,
        hideAmounts: Bool
    ) -> Bool {
        luminanceReduced || phoneHidden || hideAmounts
    }

    static func showsPriceLine(
        redacted: Bool,
        noPrice: Bool,
        pointCount: Int
    ) -> Bool {
        !redacted && !noPrice && pointCount >= 2
    }
}
