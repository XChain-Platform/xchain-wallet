/*
 * Copyright © 2025–2026 Dankest, LLC
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import Foundation
import Network

@main
struct CallbackPostExchangeCheck {
    private struct Read {
        let data: Data?
        let complete: Bool
        let failed: Bool

        static func chunk(_ text: String, complete: Bool = false) -> Read {
            Read(data: Data(text.utf8), complete: complete, failed: false)
        }
    }

    private final class ScriptedChannel: CallbackChannel {
        let startResult: Bool?
        let sendResult: Bool?
        var reads: [Read]
        var sent: [Data] = []
        var cancelCount = 0
        var lastHandler: ((Data?, Bool, Bool) -> Void)?

        init(start: Bool? = true, send: Bool? = true, reads: [Read] = []) {
            startResult = start
            sendResult = send
            self.reads = reads
        }

        func start(_ ready: @escaping (Bool) -> Void) {
            if let startResult { ready(startResult) }
        }

        func send(_ data: Data, _ done: @escaping (Bool) -> Void) {
            sent.append(data)
            if let sendResult { done(sendResult) }
        }

        func receive(_ handler: @escaping (Data?, Bool, Bool) -> Void) {
            lastHandler = handler
            guard !reads.isEmpty else { return }
            let read = reads.removeFirst()
            handler(read.data, read.complete, read.failed)
        }

        func cancel() {
            cancelCount += 1
        }

        func deliverLate() {
            lastHandler?(Data("HTTP/1.1 500 Late\r\n\r\n".utf8), true, false)
        }
    }

    private static var passed = 0

    static func main() {
        let plan = requirePlan(
            href: "https://example.com/cb?x=1",
            address: "8.8.8.8",
            body: "{\"ok\":true}"
        )
        let one = run("one chunk", plan, ScriptedChannel(reads: [
            .chunk("HTTP/1.1 204 No Content\r\n\r\n", complete: true),
        ]))
        check("one chunk status", one.status == 204)
        check("request bytes", one.channel.sent == [plan.requestData])

        let split = run("split head", plan, ScriptedChannel(reads: [
            .chunk("HTTP/1.1 204"),
            .chunk(" No Content\r\n"),
            .chunk("\r\n", complete: true),
        ]))
        check("split status", split.status == 204)

        let informational = run("informational", plan, ScriptedChannel(reads: [
            .chunk("HTTP/1.1 103 Early Hints\r\nLink: </a>\r\n\r\nHTTP/1.1 200 OK\r\n\r\n"),
        ]))
        check("informational status", informational.status == 200)

        let redirect = run("redirect", plan, ScriptedChannel(reads: [
            .chunk("HTTP/1.1 302 Found\r\n\r\n"),
        ]))
        check("redirect status", redirect.status == 302)

        let malformed = run("malformed", plan, ScriptedChannel(reads: [
            .chunk("HTTP/2 200\r\n\r\n", complete: true),
        ]))
        check("malformed status", malformed.status == nil)

        let incomplete = run("incomplete EOF", plan, ScriptedChannel(reads: [
            .chunk("HTTP/1.1 20", complete: true),
        ]))
        check("incomplete status", incomplete.status == nil)

        let failedStart = run("failed start", plan, ScriptedChannel(start: false))
        check("failed start status", failedStart.status == nil)
        check("failed start sends nothing", failedStart.channel.sent.isEmpty)

        let failedSend = run("failed send", plan, ScriptedChannel(send: false))
        check("failed send status", failedSend.status == nil)

        let failedRead = run("failed read", plan, ScriptedChannel(reads: [
            Read(data: nil, complete: false, failed: true),
        ]))
        check("failed read status", failedRead.status == nil)

        let timeout = run("read timeout", plan, ScriptedChannel(), deadlineMs: 50)
        check("timeout status", timeout.status == nil)

        let late = ScriptedChannel(reads: [.chunk("HTTP/1.1 204 No Content\r\n\r\n")])
        let completed = run("late callback", plan, late)
        late.deliverLate()
        completed.queue.sync {}
        check("late callback status", completed.status == 204)
        check("late callback completion count", completed.completionCount() == 1)
        check("late callback cancel count", late.cancelCount == 1)

        check(
            "IPv4 endpoint",
            CallbackPostExchange.endpoint(for: plan) == .hostPort(host: "8.8.8.8", port: 443)
        )
        let ipv6 = requirePlan(
            href: "https://example.com/cb",
            address: "2001:4860:4860::8888"
        )
        check(
            "IPv6 endpoint",
            CallbackPostExchange.endpoint(for: ipv6)
                == .hostPort(host: "2001:4860:4860::8888", port: 443)
        )
        let alternate = requirePlan(
            href: "https://example.com:8443/cb",
            address: "8.8.8.8"
        )
        check(
            "alternate port",
            CallbackPostExchange.endpoint(for: alternate)
                == .hostPort(host: "8.8.8.8", port: 8443)
        )
        let parameters = CallbackPostExchange.parameters(for: plan, queue: .main)
        check("no proxies", parameters.preferNoProxies)
        check(
            "TLS first",
            parameters.defaultProtocolStack.applicationProtocols.first is NWProtocolTLS.Options
        )

        print("CallbackPostExchangeCheck: \(passed) passed, 0 failed")
    }

    private static func run(
        _ name: String,
        _ plan: CallbackPostPlan,
        _ channel: ScriptedChannel,
        deadlineMs: Int = 1_000
    ) -> (
        status: Int?,
        channel: ScriptedChannel,
        queue: DispatchQueue,
        completionCount: () -> Int
    ) {
        let queue = DispatchQueue(label: "CallbackPostExchangeCheck.\(name)")
        let semaphore = DispatchSemaphore(value: 0)
        var status: Int?
        var count = 0
        CallbackPostExchange.run(
            plan: plan,
            channel: channel,
            deadlineMs: deadlineMs,
            queue: queue
        ) { value in
            count += 1
            status = value
            semaphore.signal()
        }
        guard semaphore.wait(timeout: .now() + 2) == .success else { fail("\(name) wait") }
        queue.sync {}
        check("\(name) completion count", count == 1)
        check("\(name) cancel count", channel.cancelCount == 1)
        return (status, channel, queue, { queue.sync { count } })
    }

    private static func requirePlan(
        href: String,
        address: String,
        body: String = "{}"
    ) -> CallbackPostPlan {
        guard let value = CallbackPostPlan.make(
            href: href,
            address: address,
            body: body,
            timeoutMs: 10_000,
            redirect: "manual",
            credentials: "omit",
            developerMode: false
        ) else {
            fail("make plan for \(href)")
        }
        return value
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
