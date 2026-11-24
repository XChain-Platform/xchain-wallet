import Foundation

protocol ActivityNoticePosting {
    func post(_ notice: NotifyPostArgs)
}

enum ActivityNotice {
    static let id = "io.xchain.wallet.ios.activity-check"
    static let family = "incomingReceipts"

    static func args(title: String?, body: String?) -> NotifyPostArgs? {
        guard
            let title = title?.trimmingCharacters(in: .whitespacesAndNewlines),
            !title.isEmpty,
            let body = body?.trimmingCharacters(in: .whitespacesAndNewlines),
            !body.isEmpty
        else {
            return nil
        }

        return NotifyPostArgs.parse([
            "id": id,
            "title": title,
            "body": body,
            "family": family,
        ])
    }
}
