/*
 * Copyright © 2025–2026 Dankest, LLC
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import Foundation

@main
struct BrowserReturnOpenCheck {

    private struct Result {
        let calls: [String]
        let completions: [Bool]
    }

    private static var passed = 0

    static func main() {
        let https = "https://example.com/cb?x=1"

        check(
            "chrome first succeeds",
            run(https, "chrome", [true]),
            calls: ["googlechromes://example.com/cb?x=1"],
            completion: true
        )
        check(
            "chrome fallback succeeds",
            run(https, "chrome", [false, true]),
            calls: ["googlechromes://example.com/cb?x=1", https],
            completion: true
        )
        check(
            "firefox candidates fail",
            run(https, "firefox", [false, false]),
            calls: ["firefox://open-url?url=https%3A%2F%2Fexample.com%2Fcb%3Fx%3D1", https],
            completion: false
        )
        check(
            "safari succeeds",
            run(https, "safari", [true]),
            calls: [https],
            completion: true
        )
        check("http rejected", run("http://example.com/cb", nil, []), calls: [], completion: false)
        check("invalid rejected", run("not a url", nil, []), calls: [], completion: false)

        print("BrowserReturnOpenCheck: \(passed) passed, 0 failed")
    }

    private static func run(_ url: String, _ browser: String?, _ answers: [Bool]) -> Result {
        var calls: [String] = []
        var completions: [Bool] = []

        BrowserReturnOpen.open(
            url: url,
            browser: browser,
            opener: { candidate, callback in
                calls.append(candidate.absoluteString)
                let answerIndex = calls.count - 1
                callback(answers.indices.contains(answerIndex) ? answers[answerIndex] : false)
            },
            completion: { completions.append($0) }
        )

        return Result(calls: calls, completions: completions)
    }

    private static func check(_ name: String, _ result: Result, calls: [String], completion: Bool) {
        guard result.calls == calls, result.completions == [completion] else {
            let message = "FAILED: \(name): calls=\(result.calls), completions=\(result.completions)\n"
            FileHandle.standardError.write(Data(message.utf8))
            exit(1)
        }
        passed += 1
    }
}
