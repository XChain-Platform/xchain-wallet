import Foundation

enum AlertKindLabel {
    static let keys: [String: String] = [
        "tx-confirmed": "n1.kind.txConfirmed",
        "incoming-receipt": "n1.kind.incomingReceipt",
        "coinpay-required": "n1.kind.coinpayRequired",
        "coinpay-autopaid": "n1.kind.coinpayAutopaid",
        "coinpay-autopay-manual": "n1.kind.coinpayAutopayManual",
        "incoming-pending": "n1.kind.incomingPending",
        "incoming-message": "n1.kind.incomingMessage",
        "governance-poll": "n1.kind.governancePoll",
        "deadline": "n1.kind.deadline",
        "deadline-summary": "n1.kind.deadlineSummary",
        "dispenser-escrow": "n1.kind.dispenserEscrow",
        "dispenser-fill": "n1.kind.dispenserFill",
        "order-fill": "n1.kind.orderFill",
        "price-alert": "n1.kind.priceAlert",
        "request": "n2.kind.request",
        "paydue": "n2.kind.paydue",
    ]

    static func key(kind: String) -> String? {
        keys[kind]
    }
}
