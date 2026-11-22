import Foundation

enum RequestLongLookRules {
    struct Content: Equatable {
        let titleKey: String
        let sentence: String
        let amountText: String
        let expiresInSeconds: Int64?
        let openOnPhoneKey: String
    }

    static func content(
        kind: String,
        sentence: String,
        amountText: String,
        expiresAt: Int64?,
        now: Int64
    ) -> Content? {
        switch kind {
        case "request":
            return Content(
                titleKey: "n2.kind.request",
                sentence: sentence,
                amountText: amountText,
                expiresInSeconds: nil,
                openOnPhoneKey: "n2.openOnPhone"
            )
        case "paydue":
            guard let expiresAt, expiresAt > now else {
                return nil
            }

            let milliseconds = expiresAt - now
            let seconds = milliseconds / 1_000 + (milliseconds % 1_000 == 0 ? 0 : 1)
            return Content(
                titleKey: "n2.kind.paydue",
                sentence: sentence,
                amountText: amountText,
                expiresInSeconds: seconds,
                openOnPhoneKey: "n2.openOnPhone"
            )
        default:
            return nil
        }
    }
}
