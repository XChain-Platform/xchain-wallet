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

enum CallbackPostRule {
    static let timeoutMs = 10000
    static let maxBodyBytes = 10240
    static let maxTargetLength = 2048

    static func acceptsTarget(_ href: String?, developerMode: Bool) -> Bool {
        guard let href,
              href.utf16.count <= maxTargetLength,
              !href.contains("#"),
              let components = URLComponents(string: href),
              let host = components.host,
              !host.isEmpty,
              components.user == nil,
              components.password == nil,
              let scheme = components.scheme?.lowercased()
        else {
            return false
        }

        if scheme == "https" {
            return true
        }

        guard developerMode, scheme == "http" else {
            return false
        }

        switch host.lowercased() {
        case "localhost", "127.0.0.1", "::1", "[::1]":
            return true
        default:
            return false
        }
    }

    static func bodyFits(_ body: String?) -> Bool {
        guard let body else {
            return false
        }
        return body.utf8.count <= maxBodyBytes
    }

    static func outcome(status: Int) -> String {
        (200...299).contains(status) ? "SENT" : "HTTP_STATUS"
    }
}
