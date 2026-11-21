import Foundation

@main
struct WatchTransferLedgerCheck {
    static func main() {
        emptyLedgerSendsWithoutCancellation()
        sameHashInFlightSkips()
        newHashCancelsOutstandingHandleOnce()
        finishedTransferCanSendAgain()
        keysDoNotCancelEachOther()
    }

    private static func emptyLedgerSendsWithoutCancellation() {
        var ledger = WatchTransferLedger<Int>()
        expect(
            ledger.decide(key: "detail", hash: "hash-a") == .send(cancel: []),
            "empty ledger sends with nothing to cancel"
        )
    }

    private static func sameHashInFlightSkips() {
        var ledger = WatchTransferLedger<Int>()
        ledger.started(key: "detail", hash: "hash-a", handle: 1)
        expect(
            ledger.decide(key: "detail", hash: "hash-a") == .skip,
            "same hash in flight skips"
        )
    }

    private static func newHashCancelsOutstandingHandleOnce() {
        var ledger = WatchTransferLedger<Int>()
        ledger.started(key: "detail", hash: "hash-a", handle: 1)
        expect(
            ledger.decide(key: "detail", hash: "hash-b") == .send(cancel: [1]),
            "new hash cancels the outstanding handle once"
        )
        expect(
            ledger.decide(key: "detail", hash: "hash-b") == .send(cancel: []),
            "superseded handles are dropped"
        )
    }

    private static func finishedTransferCanSendAgain() {
        var ledger = WatchTransferLedger<Int>()
        ledger.started(key: "detail", hash: "hash-a", handle: 1)
        ledger.finished(handle: 1)
        expect(
            ledger.decide(key: "detail", hash: "hash-a") == .send(cancel: []),
            "finished transfer hash sends again"
        )
    }

    private static func keysDoNotCancelEachOther() {
        var ledger = WatchTransferLedger<Int>()
        ledger.started(key: "detail", hash: "detail-a", handle: 1)
        ledger.started(key: "image", hash: "image-a", handle: 2)
        expect(
            ledger.decide(key: "detail", hash: "detail-b") == .send(cancel: [1]),
            "new content only cancels its own key"
        )
        expect(
            ledger.decide(key: "image", hash: "image-a") == .skip,
            "two keys never cancel each other"
        )
    }

    private static func expect(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else {
            FileHandle.standardError.write(Data("FAIL: \(name)\n".utf8))
            exit(1)
        }
    }
}
