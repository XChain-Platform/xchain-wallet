import Foundation

struct WatchTransferLedger<Handle: Hashable> {
    enum Decision: Equatable {
        case skip
        case send(cancel: [Handle])
    }

    private struct OutstandingTransfer {
        let hash: String
        let handle: Handle
    }

    private var transfersByKey: [String: [OutstandingTransfer]] = [:]

    mutating func decide(key: String, hash: String) -> Decision {
        guard let transfers = transfersByKey[key] else {
            return .send(cancel: [])
        }

        if transfers.contains(where: { $0.hash == hash }) {
            return .skip
        }

        transfersByKey.removeValue(forKey: key)
        return .send(cancel: transfers.map(\.handle))
    }

    mutating func started(key: String, hash: String, handle: Handle) {
        transfersByKey[key, default: []].append(
            OutstandingTransfer(hash: hash, handle: handle)
        )
    }

    mutating func finished(handle: Handle) {
        var remainingByKey: [String: [OutstandingTransfer]] = [:]

        for (key, transfers) in transfersByKey {
            let remaining = transfers.filter { $0.handle != handle }
            if !remaining.isEmpty {
                remainingByKey[key] = remaining
            }
        }

        transfersByKey = remainingByKey
    }
}
