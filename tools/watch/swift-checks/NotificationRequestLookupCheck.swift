import Foundation

@main
struct NotificationRequestLookupCheck {
    static func main() {
        let confirm = decodeRequest("request-confirm")
        let paydue = decodeRequest("request-paydue")
        let expired = decodeRequest("request-expired")

        checkMatch(confirm, category: "request", name: "request-confirm request match")
        checkNil(
            confirm,
            notificationId: confirm.id,
            category: "paydue",
            name: "request-confirm category mismatch"
        )
        checkMatch(paydue, category: "paydue", name: "request-paydue paydue match")
        checkNil(
            paydue,
            notificationId: paydue.id,
            category: "request",
            name: "request-paydue category mismatch"
        )
        checkMatch(expired, category: "paydue", name: "request-expired remains pending")
        checkNil(
            confirm,
            notificationId: "different-id",
            category: "request",
            name: "different notification id"
        )
        checkNil(confirm, notificationId: "", category: "request", name: "empty notification id")
        checkNil(confirm, notificationId: confirm.id, category: "alert", name: "alert category")
        checkNil(confirm, notificationId: confirm.id, category: "", name: "empty category")

        check(
            NotificationRequestLookup.pendingRequest(
                notificationId: confirm.id,
                category: "request",
                request: nil
            ) == nil,
            "nil request"
        )

        let emptyIdRequest = Request(
            id: "",
            kind: .request,
            iconHash: "",
            sentence: "",
            amountText: "",
            expiresAt: nil
        )
        checkNil(
            emptyIdRequest,
            notificationId: "",
            category: "request",
            name: "empty notification and request ids"
        )
    }

    private static func checkMatch(_ request: Request, category: String, name: String) {
        let result = NotificationRequestLookup.pendingRequest(
            notificationId: request.id,
            category: category,
            request: request
        )
        check(result?.id == request.id && result?.kind == request.kind, name)
    }

    private static func checkNil(
        _ request: Request,
        notificationId: String,
        category: String,
        name: String
    ) {
        check(
            NotificationRequestLookup.pendingRequest(
                notificationId: notificationId,
                category: category,
                request: request
            ) == nil,
            name
        )
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
