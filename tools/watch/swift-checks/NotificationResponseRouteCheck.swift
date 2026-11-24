import Foundation

@main
struct NotificationResponseRouteCheck {
    static func main() {
        let confirm = decodeRequest("request-confirm")
        let paydue = decodeRequest("request-paydue")

        checkRoute(
            NotificationResponseRoute.resolve(
                notificationId: confirm.id,
                category: "request",
                actionId: NotificationSceneRules.defaultActionId,
                request: confirm
            ),
            path: [.balances, .alertDetail],
            requestId: confirm.id,
            name: "request-confirm default action"
        )
        checkRoute(
            NotificationResponseRoute.resolve(
                notificationId: confirm.id,
                category: "request",
                actionId: NotificationSceneRules.openOnPhoneActionId,
                request: confirm
            ),
            path: [.balances, .alertDetail],
            requestId: confirm.id,
            name: "request-confirm open on phone"
        )
        checkNil(
            NotificationResponseRoute.resolve(
                notificationId: confirm.id,
                category: "request",
                actionId: NotificationSceneRules.dismissActionId,
                request: confirm
            ),
            "request-confirm dismiss"
        )
        checkNil(
            NotificationResponseRoute.resolve(
                notificationId: confirm.id,
                category: "request",
                actionId: "unknown",
                request: confirm
            ),
            "request-confirm unknown action"
        )
        checkRoute(
            NotificationResponseRoute.resolve(
                notificationId: paydue.id,
                category: "paydue",
                actionId: NotificationSceneRules.defaultActionId,
                request: paydue
            ),
            path: [.balances, .alertDetail],
            requestId: paydue.id,
            name: "request-paydue default action"
        )
        checkRoute(
            NotificationResponseRoute.resolve(
                notificationId: "different-id",
                category: "request",
                actionId: NotificationSceneRules.defaultActionId,
                request: confirm
            ),
            path: [.balances],
            requestId: nil,
            name: "different notification id"
        )
        checkRoute(
            NotificationResponseRoute.resolve(
                notificationId: confirm.id,
                category: "request",
                actionId: NotificationSceneRules.defaultActionId,
                request: nil
            ),
            path: [.balances],
            requestId: nil,
            name: "nil request"
        )
        checkRoute(
            NotificationResponseRoute.resolve(
                notificationId: confirm.id,
                category: "alert",
                actionId: NotificationSceneRules.defaultActionId,
                request: confirm
            ),
            path: [.balances],
            requestId: nil,
            name: "alert default action"
        )
        checkNil(
            NotificationResponseRoute.resolve(
                notificationId: confirm.id,
                category: "alert",
                actionId: NotificationSceneRules.openOnPhoneActionId,
                request: confirm
            ),
            "alert open on phone"
        )
    }

    private static func checkRoute(
        _ route: NotificationResponseRoute?,
        path: [WatchScreen],
        requestId: String?,
        name: String
    ) {
        check(route?.path == path && route?.request?.id == requestId, name)
    }

    private static func checkNil(_ route: NotificationResponseRoute?, _ name: String) {
        check(route == nil, name)
    }

    private static func decodeRequest(_ name: String) -> Request {
        let path = "test/fixtures/watch/\(name).json"
        do {
            let data = try Data(contentsOf: URL(fileURLWithPath: path))
            return try JSONDecoder().decode(Request.self, from: data)
        } catch {
            fail("\(name) fixture: \(error)")
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
