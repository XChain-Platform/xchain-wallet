import Foundation

enum NotifyActionEvent {
    static let eventName = "action"

    static func payload(
        actionId: String,
        categoryId: String,
        notificationId: String
    ) -> [String: Any]? {
        guard !notificationId.isEmpty,
              NotifyCategoryRules.isOpenOnPhone(
                  actionId: actionId,
                  categoryId: categoryId
              ) else {
            return nil
        }

        return [
            "action": "openOnPhone",
            "id": notificationId,
        ]
    }
}
