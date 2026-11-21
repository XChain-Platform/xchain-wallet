import Foundation

enum ActivityCheckRules {
    static let maxAddresses = 20
    static let parallel = 4
    static let requestTimeoutSeconds = 10
    static let runBudgetSeconds = 25

    static func pick(
        _ addresses: [String],
        lastCheckedAt: [String: Int64],
        max: Int
    ) -> [String] {
        guard max > 0 else {
            return []
        }

        var seen = Set<String>()
        var candidates: [(address: String, inputIndex: Int, lastCheckedAt: Int64?)] = []

        for (inputIndex, address) in addresses.enumerated() where seen.insert(address).inserted {
            candidates.append((address, inputIndex, lastCheckedAt[address]))
        }

        candidates.sort { lhs, rhs in
            switch (lhs.lastCheckedAt, rhs.lastCheckedAt) {
            case (nil, nil):
                return lhs.inputIndex < rhs.inputIndex
            case (nil, _):
                return true
            case (_, nil):
                return false
            case let (lhsTime?, rhsTime?):
                if lhsTime != rhsTime {
                    return lhsTime < rhsTime
                }
                return lhs.inputIndex < rhs.inputIndex
            }
        }

        return candidates.prefix(max).map(\.address)
    }

    static func applyReads(
        baseline: inout [String: [String]],
        reads: [String: [String]?]
    ) -> Bool {
        var changed = false

        for (address, read) in reads {
            guard let read else {
                continue
            }

            if let previous = baseline[address] {
                if previous != read {
                    baseline[address] = read
                    changed = true
                }
            } else {
                baseline[address] = read
            }
        }

        return changed
    }
}
