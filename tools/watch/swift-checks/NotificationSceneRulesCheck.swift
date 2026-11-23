import Foundation
import UserNotifications

@main
struct NotificationSceneRulesCheck {
    static func main() {
        check(
            NotificationSceneRules.categories
                == NotifyCategoryRules.categories(storedTitle: nil).map(\.id),
            "category order"
        )
        check(
            NotificationSceneRules.openOnPhoneActionId
                == NotifyCategoryRules.openOnPhoneActionId,
            "open on phone action id"
        )
        check(
            NotificationSceneRules.defaultActionId == UNNotificationDefaultActionIdentifier,
            "default action id"
        )
        check(
            NotificationSceneRules.dismissActionId == UNNotificationDismissActionIdentifier,
            "dismiss action id"
        )

        check(NotificationSceneRules.longLook(category: "request") == .request, "request long look")
        check(NotificationSceneRules.longLook(category: "paydue") == .request, "paydue long look")
        check(NotificationSceneRules.longLook(category: "alert") == .alert, "alert long look")
        check(NotificationSceneRules.longLook(category: "") == nil, "empty category long look")
        check(
            NotificationSceneRules.longLook(category: "txConfirmations") == nil,
            "unknown category long look"
        )

        checkResponsePath(
            category: "request",
            actionId: UNNotificationDefaultActionIdentifier,
            expected: [.balances, .alertDetail],
            name: "default request path"
        )
        checkResponsePath(
            category: "paydue",
            actionId: UNNotificationDefaultActionIdentifier,
            expected: [.balances, .alertDetail],
            name: "default paydue path"
        )
        checkResponsePath(
            category: "alert",
            actionId: UNNotificationDefaultActionIdentifier,
            expected: [.balances],
            name: "default alert path"
        )
        checkResponsePath(
            category: "txConfirmations",
            actionId: UNNotificationDefaultActionIdentifier,
            expected: [.balances],
            name: "default unknown category path"
        )
        checkResponsePath(
            category: "request",
            actionId: NotifyCategoryRules.openOnPhoneActionId,
            expected: [.balances, .alertDetail],
            name: "open on phone request path"
        )
        checkResponsePath(
            category: "paydue",
            actionId: NotifyCategoryRules.openOnPhoneActionId,
            expected: [.balances, .alertDetail],
            name: "open on phone paydue path"
        )
        checkResponsePath(
            category: "alert",
            actionId: NotifyCategoryRules.openOnPhoneActionId,
            expected: nil,
            name: "open on phone alert refusal"
        )
        checkResponsePath(
            category: "request",
            actionId: UNNotificationDismissActionIdentifier,
            expected: nil,
            name: "dismiss request refusal"
        )
        checkResponsePath(
            category: "request",
            actionId: "unknown",
            expected: nil,
            name: "unknown action refusal"
        )

        check(NotificationLongLook.alert.rawValue == "alert", "alert raw value")
        check(NotificationLongLook.request.rawValue == "request", "request raw value")
    }

    private static func checkResponsePath(
        category: String,
        actionId: String,
        expected: [WatchScreen]?,
        name: String
    ) {
        check(
            NotificationSceneRules.responsePath(category: category, actionId: actionId) == expected,
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
