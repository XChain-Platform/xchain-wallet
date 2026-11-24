/*
 * Copyright © 2025–2026 Dankest, LLC
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import Foundation

@main
struct CallbackPostCallCheck {
    private struct Read {
        let data: Data?
        let complete: Bool
        let failed: Bool

        static func response(_ text: String) -> Read {
            Read(data: Data(text.utf8), complete: true, failed: false)
        }
    }

    private final class ScriptedChannel: CallbackChannel {
        let startResult: Bool
        var reads: [Read]
        var sent: [Data] = []

        init(startResult: Bool = true, reads: [Read] = []) {
            self.startResult = startResult
            self.reads = reads
        }

        func start(_ ready: @escaping (Bool) -> Void) { ready(startResult) }

        func send(_ data: Data, _ done: @escaping (Bool) -> Void) {
            sent.append(data)
            done(true)
        }

        func receive(_ handler: @escaping (Data?, Bool, Bool) -> Void) {
            guard !reads.isEmpty else { return }
            let read = reads.removeFirst()
            handler(read.data, read.complete, read.failed)
        }

        func cancel() {}
    }

    private struct Result {
        let outcome: CallbackPostCall.Outcome
        let channel: ScriptedChannel
        let factoryCount: Int
        let plan: CallbackPostPlan?
        let factoryUsedQueue: Bool
    }

    private static var passed = 0

    static func main() {
        let href = "https://example.com/cb?x=1"
        let address = "8.8.8.8"
        let body = "{\"ok\":true}"
        let expected = CallbackPostPlan.make(
            href: href, address: address, body: body, timeoutMs: 10_000,
            redirect: "manual", credentials: "omit", developerMode: false
        )!
        let accepted = run(
            "accepted", href: href, address: address, body: body,
            channel: ScriptedChannel(reads: [.response("HTTP/1.1 204 No Content\r\n\r\n")])
        )
        check("accepted status", accepted.outcome == .status(204))
        check("accepted factory count", accepted.factoryCount == 1)
        check("accepted plan", accepted.plan == expected)
        check("accepted queue", accepted.factoryUsedQueue)
        check("accepted request bytes", accepted.channel.sent == [expected.requestData])

        let serverError = run(
            "server error", href: href, address: address, body: body,
            channel: ScriptedChannel(reads: [
                .response("HTTP/1.1 500 Internal Server Error\r\n\r\n"),
            ])
        )
        check("server error status", serverError.outcome == .status(500))

        refused("redirect", href: href, address: address, body: body, redirect: "follow")
        refused("credentials", href: href, address: address, body: body, credentials: "include")
        refused("timeout", href: href, address: address, body: body, timeoutMs: nil)
        refused("loopback", href: href, address: "127.0.0.1", body: body)
        refused("hostname address", href: href, address: "example.com", body: body)
        refused(
            "developer target", href: "http://localhost:8080/cb",
            address: "127.0.0.1", body: body
        )

        let failedStart = run(
            "failed start", href: href, address: address, body: body,
            channel: ScriptedChannel(startResult: false)
        )
        check(
            "failed start outcome",
            failedStart.outcome == .rejected(CallbackPostPlan.failedMessage)
        )

        let failedRead = run(
            "failed read", href: href, address: address, body: body,
            channel: ScriptedChannel(reads: [Read(data: nil, complete: false, failed: true)])
        )
        check(
            "failed read outcome",
            failedRead.outcome == .rejected(CallbackPostPlan.failedMessage)
        )

        print("CallbackPostCallCheck: \(passed) passed, 0 failed")
    }

    private static func refused(
        _ name: String,
        href: String?,
        address: String?,
        body: String?,
        timeoutMs: Double? = 10_000,
        redirect: String? = "manual",
        credentials: String? = "omit"
    ) {
        let result = run(
            name, href: href, address: address, body: body, timeoutMs: timeoutMs,
            redirect: redirect, credentials: credentials, channel: ScriptedChannel()
        )
        check(
            "\(name) outcome",
            result.outcome == .rejected(CallbackPostPlan.refusedMessage)
        )
        check("\(name) factory count", result.factoryCount == 0)
    }

    private static func run(
        _ name: String,
        href: String?,
        address: String?,
        body: String?,
        timeoutMs: Double? = 10_000,
        redirect: String? = "manual",
        credentials: String? = "omit",
        channel: ScriptedChannel
    ) -> Result {
        let queue = DispatchQueue(label: "CallbackPostCallCheck.\(name)")
        let key = DispatchSpecificKey<String>()
        queue.setSpecific(key: key, value: name)
        let semaphore = DispatchSemaphore(value: 0)
        var outcome: CallbackPostCall.Outcome?
        var completionCount = 0
        var completedOnQueue = false
        var factoryCount = 0
        var recordedPlan: CallbackPostPlan?
        var factoryUsedQueue = false

        CallbackPostCall.send(
            href: href, address: address, body: body, timeoutMs: timeoutMs,
            redirect: redirect, credentials: credentials,
            channel: { plan, suppliedQueue in
                factoryCount += 1
                recordedPlan = plan
                factoryUsedQueue = suppliedQueue === queue
                return channel
            },
            queue: queue
        ) { value in
            completionCount += 1
            outcome = value
            completedOnQueue = DispatchQueue.getSpecific(key: key) == name
            semaphore.signal()
        }

        guard semaphore.wait(timeout: .now() + 2) == .success else { fail("\(name) wait") }
        queue.sync {}
        check("\(name) completion count", completionCount == 1)
        check("\(name) completion queue", completedOnQueue)
        guard let outcome else { fail("\(name) outcome missing") }
        return Result(
            outcome: outcome, channel: channel, factoryCount: factoryCount,
            plan: recordedPlan, factoryUsedQueue: factoryUsedQueue
        )
    }

    private static func check(_ name: String, _ condition: @autoclosure () -> Bool) {
        guard condition() else { fail(name) }
        passed += 1
    }

    private static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
        exit(1)
    }
}
