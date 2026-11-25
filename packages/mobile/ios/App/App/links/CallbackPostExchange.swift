// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import Foundation
import Network
import Security

protocol CallbackChannel: AnyObject {
    func start(_ ready: @escaping (Bool) -> Void)
    func send(_ data: Data, _ done: @escaping (Bool) -> Void)
    func receive(_ handler: @escaping (Data?, Bool, Bool) -> Void)
    func cancel()
}

enum CallbackPostExchange {
    static func run(
        plan: CallbackPostPlan,
        channel: CallbackChannel,
        deadlineMs: Int = CallbackPostRule.timeoutMs,
        queue: DispatchQueue,
        completion: @escaping (Int?) -> Void
    ) {
        let runner = Runner(plan: plan, channel: channel, queue: queue, completion: completion)
        let deadline = DispatchTime.now() + .milliseconds(max(0, deadlineMs))
        queue.async { runner.begin(deadline: deadline) }
    }

    static func endpoint(for plan: CallbackPostPlan) -> NWEndpoint {
        .hostPort(
            host: NWEndpoint.Host(plan.target.addressText),
            port: NWEndpoint.Port(rawValue: UInt16(plan.target.port))!
        )
    }

    static func parameters(for plan: CallbackPostPlan, queue: DispatchQueue) -> NWParameters {
        let tls = NWProtocolTLS.Options()
        let options = tls.securityProtocolOptions
        if let serverName = plan.target.serverName {
            sec_protocol_options_set_tls_server_name(options, serverName)
        }
        sec_protocol_options_set_verify_block(options, { _, trust, answer in
            let presented = sec_trust_copy_ref(trust).takeRetainedValue()
            answer(CallbackPinnedTrust.evaluate(presented, name: plan.trustName))
        }, queue)
        let parameters = NWParameters(tls: tls, tcp: NWProtocolTCP.Options())
        parameters.preferNoProxies = true
        return parameters
    }

    static func networkChannel(for plan: CallbackPostPlan, queue: DispatchQueue) -> CallbackChannel {
        NetworkChannel(
            connection: NWConnection(to: endpoint(for: plan), using: parameters(for: plan, queue: queue)),
            queue: queue
        )
    }

    private final class Runner {
        private let plan: CallbackPostPlan
        private let channel: CallbackChannel
        private let queue: DispatchQueue
        private let completion: (Int?) -> Void
        private let finishLock = NSLock()
        private var buffer = Data()
        private var didFinish = false

        init(
            plan: CallbackPostPlan,
            channel: CallbackChannel,
            queue: DispatchQueue,
            completion: @escaping (Int?) -> Void
        ) {
            self.plan = plan
            self.channel = channel
            self.queue = queue
            self.completion = completion
        }

        func begin(deadline: DispatchTime) {
            queue.asyncAfter(deadline: deadline) { self.finish(nil) }
            channel.start { [weak self] ready in
                self?.queue.async { self?.didStart(ready) }
            }
        }

        private func didStart(_ ready: Bool) {
            guard !isFinished else { return }
            guard ready else { return finish(nil) }
            channel.send(plan.requestData) { [weak self] sent in
                self?.queue.async { self?.didSend(sent) }
            }
        }

        private func didSend(_ sent: Bool) {
            guard !isFinished else { return }
            guard sent else { return finish(nil) }
            read()
        }

        private func read() {
            channel.receive { [weak self] chunk, peerFinished, failed in
                self?.queue.async { self?.didReceive(chunk, peerFinished, failed) }
            }
        }

        private func didReceive(_ chunk: Data?, _ peerFinished: Bool, _ failed: Bool) {
            guard !isFinished else { return }
            guard !failed else { return finish(nil) }
            if let chunk { buffer.append(chunk) }
            switch CallbackPostPlan.step(
                head: CallbackHttpWire.parseHead(buffer),
                isComplete: peerFinished
            ) {
            case let .resolve(status): finish(status)
            case .fail: finish(nil)
            case .readMore: read()
            }
        }

        private func finish(_ status: Int?) {
            finishLock.lock()
            guard !didFinish else {
                finishLock.unlock()
                return
            }
            didFinish = true
            finishLock.unlock()
            channel.cancel()
            completion(status)
        }

        private var isFinished: Bool {
            finishLock.lock()
            defer { finishLock.unlock() }
            return didFinish
        }
    }

    private final class NetworkChannel: CallbackChannel {
        private let connection: NWConnection
        private let queue: DispatchQueue
        private var answeredStart = false

        init(connection: NWConnection, queue: DispatchQueue) {
            self.connection = connection
            self.queue = queue
        }

        func start(_ ready: @escaping (Bool) -> Void) {
            connection.stateUpdateHandler = { [weak self] state in
                guard let self, !answeredStart else { return }
                switch state {
                case .ready: answerStart(true, ready)
                case .failed, .cancelled: answerStart(false, ready)
                default: break
                }
            }
            connection.start(queue: queue)
        }

        func send(_ data: Data, _ done: @escaping (Bool) -> Void) {
            connection.send(content: data, completion: .contentProcessed { done($0 == nil) })
        }

        func receive(_ handler: @escaping (Data?, Bool, Bool) -> Void) {
            connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) {
                data, _, complete, error in
                handler(data, complete, error != nil)
            }
        }

        func cancel() {
            connection.cancel()
        }

        private func answerStart(_ result: Bool, _ handler: (Bool) -> Void) {
            answeredStart = true
            connection.stateUpdateHandler = nil
            handler(result)
        }
    }
}
