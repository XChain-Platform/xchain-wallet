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

enum CallbackPostCall {
    enum Outcome: Equatable {
        case status(Int)
        case rejected(String)
    }

    typealias ChannelFactory = (CallbackPostPlan, DispatchQueue) -> CallbackChannel

    static let systemChannel: ChannelFactory = { plan, queue in
        CallbackPostExchange.networkChannel(for: plan, queue: queue)
    }

    static func send(
        href: String?, address: String?, body: String?, timeoutMs: Double?,
        redirect: String?, credentials: String?,
        channel: @escaping ChannelFactory = systemChannel,
        queue: DispatchQueue,
        completion: @escaping (Outcome) -> Void
    ) {
        guard let plan = CallbackPostPlan.make(
            href: href, address: address, body: body, timeoutMs: timeoutMs,
            redirect: redirect, credentials: credentials, developerMode: false
        ) else {
            return queue.async { completion(.rejected(CallbackPostPlan.refusedMessage)) }
        }
        CallbackPostExchange.run(plan: plan, channel: channel(plan, queue), queue: queue) {
            completion($0.map(Outcome.status) ?? .rejected(CallbackPostPlan.failedMessage))
        }
    }
}
