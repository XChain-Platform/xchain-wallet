import Foundation

@main
struct NotifyActionEventCheck {
    static func main() {
        checkPayload(
            NotifyActionEvent.payload(
                actionId: "openOnPhone",
                categoryId: "request",
                notificationId: "req-1"
            ),
            "openOnPhone request payload"
        )
        checkPayload(
            NotifyActionEvent.payload(
                actionId: "openOnPhone",
                categoryId: "paydue",
                notificationId: "req-1"
            ),
            "openOnPhone paydue payload"
        )
        check(
            NotifyActionEvent.payload(
                actionId: "openOnPhone",
                categoryId: "alert",
                notificationId: "req-1"
            ) == nil,
            "openOnPhone alert refusal"
        )
        check(
            NotifyActionEvent.payload(
                actionId: "unknown",
                categoryId: "request",
                notificationId: "req-1"
            ) == nil,
            "unknown request action refusal"
        )
        check(
            NotifyActionEvent.payload(
                actionId: "openOnPhone",
                categoryId: "request",
                notificationId: ""
            ) == nil,
            "empty notification id refusal"
        )
        check(NotifyActionEvent.eventName == "action", "event name")

        let adapter = read(
            "packages/web/src/notifications/nativeNotifyAdapter.js",
            "native notify adapter"
        )
        check(
            adapter.contains("NATIVE_NOTIFY_ACTION_EVENT = 'action'"),
            "native notify adapter event name"
        )

        let service = read(
            "packages/core/src/notifications/NotificationService.js",
            "notification service"
        )
        check(
            service.contains("event?.action !== 'openOnPhone'"),
            "notification service action key"
        )
        check(
            service.contains("event.id !== this._requestAlert.id"),
            "notification service id key"
        )
    }

    private static func checkPayload(_ payload: [String: Any]?, _ name: String) {
        check(
            payload?.count == 2
                && payload?["action"] as? String == "openOnPhone"
                && payload?["id"] as? String == "req-1",
            name
        )
    }

    private static func read(_ path: String, _ name: String) -> String {
        guard let contents = try? String(contentsOfFile: path, encoding: .utf8) else {
            fail("read \(name)")
        }
        return contents
    }

    private static func check(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else {
            fail(name)
        }
    }

    private static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("FAIL: \(name)\n".utf8))
        exit(1)
    }
}
