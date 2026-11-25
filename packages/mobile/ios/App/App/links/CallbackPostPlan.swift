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

struct CallbackPostPlan: Equatable {
    let target: CallbackPinnedTarget
    let trustName: String
    let requestData: Data

    static let refusedMessage = "Callback request refused"
    static let failedMessage = "Callback POST failed"

    static func make(
        href: String?,
        address: String?,
        body: String?,
        timeoutMs: Double?,
        redirect: String?,
        credentials: String?,
        developerMode: Bool
    ) -> CallbackPostPlan? {
        guard let request = CallbackPostRequest.check(
            href: href,
            address: address,
            body: body,
            timeoutMs: timeoutMs,
            redirect: redirect,
            credentials: credentials,
            developerMode: developerMode
        ),
        let target = CallbackPinnedTarget.make(href: request.href, address: request.address),
        let requestData = CallbackHttpWire.requestData(target: target, body: request.body)
        else {
            return nil
        }

        return CallbackPostPlan(
            target: target,
            trustName: CallbackPinnedTrust.trustName(for: target),
            requestData: requestData
        )
    }

    enum Step: Equatable {
        case resolve(Int)
        case readMore
        case fail
    }

    static func step(head: CallbackHttpWire.Head, isComplete: Bool) -> Step {
        switch head {
        case let .status(status):
            return .resolve(status)
        case .malformed:
            return .fail
        case .incomplete:
            return isComplete ? .fail : .readMore
        }
    }
}
