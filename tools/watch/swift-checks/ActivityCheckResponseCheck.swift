import Foundation

@main
struct ActivityCheckResponseCheck {
    private struct Check {
        let name: String
        let data: Data
        let expected: [String]?
    }

    static func main() {
        let checks = [
            Check(
                name: "valid balances",
                data: json(#"{"balances":{"confirmed":"0.5","pending":"-0.1"}}"#),
                expected: ["0.5", "-0.1"]
            ),
            Check(
                name: "null pending",
                data: json(#"{"balances":{"confirmed":"0.5","pending":null}}"#),
                expected: nil
            ),
            Check(
                name: "absent pending",
                data: json(#"{"balances":{"confirmed":"0.5"}}"#),
                expected: nil
            ),
            Check(
                name: "numeric confirmed",
                data: json(#"{"balances":{"confirmed":0.5,"pending":"-0.1"}}"#),
                expected: nil
            ),
            Check(
                name: "error object",
                data: json(#"{"error":"x"}"#),
                expected: nil
            ),
            Check(
                name: "top-level array",
                data: json(#"["0.5","-0.1"]"#),
                expected: nil
            ),
            Check(
                name: "invalid JSON",
                data: Data([0xff, 0xfe, 0xfd]),
                expected: nil
            ),
        ]

        for check in checks {
            let actual = ActivityCheckResponse.strings(
                from: check.data,
                confirmedPath: "balances.confirmed",
                pendingPath: "balances.pending"
            )
            guard actual == check.expected else {
                print("failed: \(check.name)")
                Foundation.exit(1)
            }
        }
    }

    private static func json(_ value: String) -> Data {
        Data(value.utf8)
    }
}
