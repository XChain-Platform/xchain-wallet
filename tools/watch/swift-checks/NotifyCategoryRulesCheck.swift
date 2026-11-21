import Foundation

@main
struct NotifyCategoryRulesCheck {
    static func main() {
        check(
            NotifyCategoryRules.categories(storedTitle: "Open on iPhone") == [
                .init(id: "request", openOnPhoneTitle: "Open on iPhone"),
                .init(id: "paydue", openOnPhoneTitle: "Open on iPhone"),
                .init(id: "alert", openOnPhoneTitle: nil),
            ],
            "stored title and category order"
        )

        checkNoActions(storedTitle: nil, name: "nil title")
        checkNoActions(storedTitle: "", name: "empty title")
        checkNoActions(storedTitle: " \t\n\r ", name: "whitespace-only title")

        check(
            NotifyCategoryRules.categories(storedTitle: " \n Open on iPhone \t") == [
                .init(id: "request", openOnPhoneTitle: "Open on iPhone"),
                .init(id: "paydue", openOnPhoneTitle: "Open on iPhone"),
                .init(id: "alert", openOnPhoneTitle: nil),
            ],
            "padded title trimming"
        )

        check(
            NotifyCategoryRules.isOpenOnPhone(actionId: "openOnPhone", categoryId: "request"),
            "openOnPhone request acceptance"
        )
        check(
            NotifyCategoryRules.isOpenOnPhone(actionId: "openOnPhone", categoryId: "paydue"),
            "openOnPhone paydue acceptance"
        )
        check(
            !NotifyCategoryRules.isOpenOnPhone(actionId: "openOnPhone", categoryId: "alert"),
            "openOnPhone alert refusal"
        )
        check(
            !NotifyCategoryRules.isOpenOnPhone(
                actionId: "com.apple.UNNotificationDefaultActionIdentifier",
                categoryId: "request"
            ),
            "default action refusal"
        )
        check(
            !NotifyCategoryRules.isOpenOnPhone(actionId: "", categoryId: "request"),
            "empty action refusal"
        )
    }

    private static func checkNoActions(storedTitle: String?, name: String) {
        check(
            NotifyCategoryRules.categories(storedTitle: storedTitle) == [
                .init(id: "request", openOnPhoneTitle: nil),
                .init(id: "paydue", openOnPhoneTitle: nil),
                .init(id: "alert", openOnPhoneTitle: nil),
            ],
            name
        )
    }

    private static func check(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else {
            FileHandle.standardError.write(Data("FAIL: \(name)\n".utf8))
            exit(1)
        }
    }
}
