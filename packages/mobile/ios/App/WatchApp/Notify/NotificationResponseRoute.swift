import Foundation

struct NotificationResponseRoute {
    let path: [WatchScreen]
    let request: Request?

    static func resolve(
        notificationId: String,
        category: String,
        actionId: String,
        request: Request?
    ) -> NotificationResponseRoute? {
        guard let path = NotificationSceneRules.responsePath(
            category: category,
            actionId: actionId
        ) else {
            return nil
        }

        guard path.last == .alertDetail else {
            return NotificationResponseRoute(path: path, request: nil)
        }

        guard let pendingRequest = NotificationRequestLookup.pendingRequest(
            notificationId: notificationId,
            category: category,
            request: request
        ) else {
            return NotificationResponseRoute(path: [.balances], request: nil)
        }

        return NotificationResponseRoute(path: path, request: pendingRequest)
    }
}
