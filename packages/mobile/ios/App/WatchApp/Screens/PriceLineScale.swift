import Foundation

enum PriceLineScale {
    enum Tone: String {
        case gain
        case loss
    }

    static func tone(up: Bool) -> Tone {
        up ? .gain : .loss
    }

    static func xDomain(count: Int) -> ClosedRange<Double>? {
        guard count >= 2 else {
            return nil
        }

        return 0...Double(count - 1)
    }

    static func yDomain(_ points: [Double]) -> ClosedRange<Double>? {
        guard points.count >= 2, points.allSatisfy(\.isFinite),
              let lowest = points.min(), let highest = points.max() else {
            return nil
        }

        guard lowest == highest else {
            return lowest...highest
        }

        let pad = lowest == 0 ? 1 : abs(lowest) * 0.01
        return (lowest - pad)...(highest + pad)
    }
}
