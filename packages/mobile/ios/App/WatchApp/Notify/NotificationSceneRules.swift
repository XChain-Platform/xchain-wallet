import Foundation

enum NotificationLongLook: String, CaseIterable {
    case alert
    case request
}

enum NotificationSceneRules {
    static let categories = ["request", "paydue", "alert"]
    static let openOnPhoneActionId = "openOnPhone"
    static let defaultActionId = "com.apple.UNNotificationDefaultActionIdentifier"
    static let dismissActionId = "com.apple.UNNotificationDismissActionIdentifier"

    static func longLook(category: String) -> NotificationLongLook? {
        switch category {
        case "request", "paydue":
            return .request
        case "alert":
            return .alert
        default:
            return nil
        }
    }

    static func responsePath(category: String, actionId: String) -> [WatchScreen]? {
        if actionId == defaultActionId {
            return WatchScreenGraph.notificationPath(category: category)
        }

        if actionId == openOnPhoneActionId,
           category == "request" || category == "paydue" {
            return WatchScreenGraph.notificationPath(category: category)
        }

        return nil
    }
}
