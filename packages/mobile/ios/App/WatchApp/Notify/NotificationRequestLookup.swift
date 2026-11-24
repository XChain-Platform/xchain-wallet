import Foundation

enum NotificationRequestLookup {
    static func pendingRequest(
        notificationId: String,
        category: String,
        request: Request?
    ) -> Request? {
        guard !notificationId.isEmpty,
              NotificationSceneRules.longLook(category: category) == .request,
              let request,
              request.id == notificationId,
              request.kind.rawValue == category else {
            return nil
        }

        return request
    }
}
