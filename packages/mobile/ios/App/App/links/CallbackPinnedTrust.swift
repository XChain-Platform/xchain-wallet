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
import Security

enum CallbackPinnedTrust {
    static func trustName(for target: CallbackPinnedTarget) -> String {
        target.serverName ?? target.addressText
    }

    static func evaluate(_ trust: SecTrust, name: String) -> Bool {
        guard !name.isEmpty else { return false }
        let policy = SecPolicyCreateSSL(true, name as CFString)
        guard SecTrustSetPolicies(trust, policy) == errSecSuccess else { return false }
        return SecTrustEvaluateWithError(trust, nil)
    }

    static func disposition(
        method: String,
        trust: SecTrust?,
        name: String
    ) -> (URLSession.AuthChallengeDisposition, URLCredential?) {
        guard method == NSURLAuthenticationMethodServerTrust else {
            return (.performDefaultHandling, nil)
        }
        guard let trust, evaluate(trust, name: name) else {
            return (.cancelAuthenticationChallenge, nil)
        }
        return (.useCredential, URLCredential(trust: trust))
    }
}
