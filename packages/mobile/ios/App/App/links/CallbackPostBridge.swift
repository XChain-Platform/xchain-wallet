// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import Capacitor
import Foundation

enum CallbackPostBridge {
    static let queue = DispatchQueue(label: "xchain-callback-post")

    static func handle(
        _ call: CAPPluginCall,
        channel: @escaping CallbackPostCall.ChannelFactory = CallbackPostCall.systemChannel,
        queue: DispatchQueue = CallbackPostBridge.queue
    ) {
        let href = call.getString("href")
        let address = call.getString("address")
        let body = call.getString("body")
        let timeoutMs = call.getDouble("timeoutMs")
        let redirect = call.getString("redirect")
        let credentials = call.getString("credentials")

        queue.async {
            CallbackPostCall.send(
                href: href, address: address, body: body, timeoutMs: timeoutMs,
                redirect: redirect, credentials: credentials, channel: channel, queue: queue
            ) { outcome in
                switch outcome {
                case let .status(status): call.resolve(["status": status])
                case let .rejected(message): call.reject(message)
                }
            }
        }
    }
}
