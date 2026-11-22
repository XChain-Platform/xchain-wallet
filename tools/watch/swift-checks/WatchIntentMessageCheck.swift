import Foundation

@main
enum WatchIntentMessageCheck {
    private static var passed = 0

    static func main() {
        checkRoundTrip(
            "refresh round trip",
            kind: "refresh",
            value: RefreshIntent(),
            expected: [:]
        )
        checkRoundTrip(
            "detailRequest round trip",
            kind: "detailRequest",
            value: DetailRequestIntent(tokenId: "token-1"),
            expected: ["tokenId": "token-1"]
        )
        checkRoundTrip(
            "openOnPhone round trip",
            kind: "openOnPhone",
            value: OpenOnPhoneIntent(route: "/wallet/token-1"),
            expected: ["route": "/wallet/token-1"]
        )
        checkRoundTrip(
            "markRead round trip",
            kind: "markRead",
            value: MarkReadIntent(id: "alert-1"),
            expected: ["id": "alert-1"]
        )
        checkRoundTrip(
            "watchState round trip",
            kind: "watchState",
            value: WatchStateIntent(appVersion: "1.2.3"),
            expected: ["appVersion": "1.2.3"]
        )

        for kind in ["approve", "Refresh", ""] {
            check("message rejects kind \(display(kind))") {
                PhoneIntentMessage.message(kind: kind, value: RefreshIntent()) == nil
            }
        }
        check("message rejects string value") {
            PhoneIntentMessage.message(kind: "refresh", value: "not an object") == nil
        }
        check("message rejects array value") {
            PhoneIntentMessage.message(kind: "refresh", value: ["not an object"]) == nil
        }

        check("read rejects missing kind") {
            WatchIntentMessage.read(["value": [:]]) == nil
        }
        check("read rejects missing value") {
            WatchIntentMessage.read(["kind": "refresh"]) == nil
        }
        check("read rejects a third key") {
            WatchIntentMessage.read([
                "kind": "refresh",
                "value": [:],
                "extra": true,
            ]) == nil
        }
        check("read rejects numeric kind") {
            WatchIntentMessage.read(["kind": 1, "value": [:]]) == nil
        }
        check("read rejects unlisted kind") {
            WatchIntentMessage.read(["kind": "approve", "value": [:]]) == nil
        }
        check("read rejects string value") {
            WatchIntentMessage.read(["kind": "refresh", "value": "not an object"]) == nil
        }
        check("read rejects array value") {
            WatchIntentMessage.read(["kind": "refresh", "value": []]) == nil
        }

        check("both kinds lists are equal") {
            PhoneIntentMessage.kinds == WatchIntentMessage.kinds
        }
        check("kinds have the required order") {
            PhoneIntentMessage.kinds == [
                "refresh",
                "detailRequest",
                "openOnPhone",
                "markRead",
                "watchState",
            ]
        }
        checkSchemaDefinitions()

        print("PASS: \(passed) checks")
    }

    private static func checkRoundTrip<Value: Encodable>(
        _ name: String,
        kind: String,
        value: Value,
        expected: [String: String]
    ) {
        check(name) {
            guard let message = PhoneIntentMessage.message(kind: kind, value: value),
                  Set(message.keys) == Set(["kind", "value"]),
                  let read = WatchIntentMessage.read(message),
                  read.kind == kind,
                  read.value.count == expected.count else {
                return false
            }

            return expected.allSatisfy { key, value in
                read.value[key] as? String == value
            }
        }
    }

    private static func checkSchemaDefinitions() {
        let path = "packages/core/src/watch/contract/intents.schema.json"
        let definitions: [String: Any]

        do {
            let data = try Data(contentsOf: URL(fileURLWithPath: path))
            guard let schema = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let decoded = schema["$defs"] as? [String: Any] else {
                fail("schema $defs is not an object")
            }
            definitions = decoded
        } catch {
            fail("could not read \(path): \(error)")
        }

        for kind in PhoneIntentMessage.kinds {
            check("schema contains $defs.\(kind)") {
                definitions[kind] != nil
            }
        }
    }

    private static func check(_ name: String, _ condition: () -> Bool) {
        guard condition() else {
            fail(name)
        }
        passed += 1
    }

    private static func display(_ value: String) -> String {
        value.isEmpty ? "<empty>" : value
    }

    private static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
        exit(1)
    }
}
