import Foundation

@main
struct PriceLineScaleCheck {
    private static let tolerance = 1e-9

    static func main() {
        expectTone("tone up", actual: PriceLineScale.tone(up: true), expected: .gain)
        expectTone("tone down", actual: PriceLineScale.tone(up: false), expected: .loss)

        expectRange("xDomain 48", actual: PriceLineScale.xDomain(count: 48), lower: 0, upper: 47)
        expectRange("xDomain 2", actual: PriceLineScale.xDomain(count: 2), lower: 0, upper: 1)
        expectNil("xDomain 1", PriceLineScale.xDomain(count: 1))
        expectNil("xDomain 0", PriceLineScale.xDomain(count: 0))

        expectRange("unordered points", actual: PriceLineScale.yDomain([3, 1, 2]), lower: 1, upper: 3)

        let fallingPoints = (0..<48).map { Double(48 - $0) }
        expectRange("48 falling points", actual: PriceLineScale.yDomain(fallingPoints), lower: 1, upper: 48)

        expectRange("flat positive", actual: PriceLineScale.yDomain([5, 5]), lower: 4.95, upper: 5.05)
        expectRange("flat zero", actual: PriceLineScale.yDomain([0, 0]), lower: -1, upper: 1)
        expectRange("flat negative", actual: PriceLineScale.yDomain([-2, -2]), lower: -2.02, upper: -1.98)

        expectNil("empty points", PriceLineScale.yDomain([]))
        expectNil("one point", PriceLineScale.yDomain([1]))
        expectNil("NaN point", PriceLineScale.yDomain([1, .nan]))
        expectNil("infinite point", PriceLineScale.yDomain([1, .infinity]))
    }

    private static func expectTone(_ name: String, actual: PriceLineScale.Tone, expected: PriceLineScale.Tone) {
        guard actual.rawValue == expected.rawValue else {
            fail(name)
        }
    }

    private static func expectRange(
        _ name: String,
        actual: ClosedRange<Double>?,
        lower: Double,
        upper: Double
    ) {
        guard let actual,
              abs(actual.lowerBound - lower) <= tolerance,
              abs(actual.upperBound - upper) <= tolerance else {
            fail(name)
        }
    }

    private static func expectNil(_ name: String, _ actual: ClosedRange<Double>?) {
        guard actual == nil else {
            fail(name)
        }
    }

    private static func fail(_ name: String) -> Never {
        print("FAILED: \(name)")
        exit(1)
    }
}
