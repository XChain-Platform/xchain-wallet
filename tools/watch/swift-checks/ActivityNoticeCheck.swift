import Foundation

@main
enum ActivityNoticeCheck {
    static func main() {
        let expected = NotifyPostArgs(
            id: "io.xchain.wallet.ios.activity-check",
            title: "New activity",
            body: "You received a payment",
            family: "incomingReceipts",
            sound: .systemDefault,
            category: nil,
            threadId: "incomingReceipts"
        )
        let first = ActivityNotice.args(
            title: "New activity",
            body: "You received a payment"
        )

        check("valid notice", first == expected)
        check(
            "stable notice",
            ActivityNotice.args(
                title: "New activity",
                body: "You received a payment"
            ) == first
        )
        check(
            "trimmed title",
            ActivityNotice.args(
                title: " \nNew activity\t ",
                body: "You received a payment"
            )?.title == "New activity"
        )
        check("nil title", ActivityNotice.args(title: nil, body: "body") == nil)
        check("nil body", ActivityNotice.args(title: "title", body: nil) == nil)
        check("empty title", ActivityNotice.args(title: "", body: "body") == nil)
        check("whitespace body", ActivityNotice.args(title: "title", body: " \n\t ") == nil)

        let recorder = RecordingPoster()
        let poster: ActivityNoticePosting = recorder
        if let first {
            poster.post(first)
        }
        check("protocol posting", recorder.notices == [expected])
    }

    private static func check(_ name: String, _ passed: @autoclosure () -> Bool) {
        guard passed() else {
            FileHandle.standardError.write(Data("failed: \(name)\n".utf8))
            exit(1)
        }
    }
}

private final class RecordingPoster: ActivityNoticePosting {
    private(set) var notices: [NotifyPostArgs] = []

    func post(_ notice: NotifyPostArgs) {
        notices.append(notice)
    }
}
