import Foundation

@main
struct RequestLongLookRulesCheck {
    static func main() {
        let sentence = "Alice requested a payment"
        let amountText = "10 XRP"
        let now: Int64 = 1_700_000_000_000

        check(
            RequestLongLookRules.content(
                kind: "request",
                sentence: sentence,
                amountText: amountText,
                expiresAt: nil,
                now: now
            ) == .init(
                titleKey: "n2.kind.request",
                sentence: sentence,
                amountText: amountText,
                expiresInSeconds: nil,
                openOnPhoneKey: "n2.openOnPhone"
            ),
            "request with no expiry"
        )

        check(
            RequestLongLookRules.content(
                kind: "paydue",
                sentence: sentence,
                amountText: amountText,
                expiresAt: now + 90_001,
                now: now
            ) == .init(
                titleKey: "n2.kind.paydue",
                sentence: sentence,
                amountText: amountText,
                expiresInSeconds: 91,
                openOnPhoneKey: "n2.openOnPhone"
            ),
            "paydue rounds 90001 milliseconds up to 91 seconds"
        )

        check(
            RequestLongLookRules.content(
                kind: "paydue",
                sentence: sentence,
                amountText: amountText,
                expiresAt: now,
                now: now
            ) == nil,
            "paydue exactly at now"
        )
        check(
            RequestLongLookRules.content(
                kind: "paydue",
                sentence: sentence,
                amountText: amountText,
                expiresAt: now - 1,
                now: now
            ) == nil,
            "paydue one millisecond before now"
        )
        check(
            RequestLongLookRules.content(
                kind: "paydue",
                sentence: sentence,
                amountText: amountText,
                expiresAt: nil,
                now: now
            ) == nil,
            "paydue with no expiry"
        )

        check(
            RequestLongLookRules.content(
                kind: "request",
                sentence: sentence,
                amountText: amountText,
                expiresAt: now + 1,
                now: now
            ) == .init(
                titleKey: "n2.kind.request",
                sentence: sentence,
                amountText: amountText,
                expiresInSeconds: nil,
                openOnPhoneKey: "n2.openOnPhone"
            ),
            "request carrying an expiry still has no expiry"
        )
        check(
            RequestLongLookRules.content(
                kind: "alert",
                sentence: sentence,
                amountText: amountText,
                expiresAt: nil,
                now: now
            ) == nil,
            "alert kind"
        )
        check(
            RequestLongLookRules.content(
                kind: "",
                sentence: sentence,
                amountText: amountText,
                expiresAt: nil,
                now: now
            ) == nil,
            "empty kind"
        )

        let strings = readStrings()
        for key in ["n2.kind.request", "n2.kind.paydue", "n2.openOnPhone"] {
            check(strings[key] != nil, "strings file contains \(key)")
        }
    }

    private static func readStrings() -> [String: Any] {
        let path = "packages/core/src/watch/contract/strings-surfaces.json"
        do {
            let data = try Data(contentsOf: URL(fileURLWithPath: path))
            guard let strings = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                fail("strings file is an object")
            }
            return strings
        } catch {
            fail("read strings file: \(error)")
        }
    }

    private static func check(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else {
            fail(name)
        }
    }

    private static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
        exit(1)
    }
}
