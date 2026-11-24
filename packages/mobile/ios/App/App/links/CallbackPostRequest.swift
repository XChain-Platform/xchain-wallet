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

struct CallbackPostRequest: Equatable {
    let href: String
    let body: String
    let address: [UInt8]

    static func check(
        href: String?,
        address: String?,
        body: String?,
        timeoutMs: Double?,
        redirect: String?,
        credentials: String?,
        developerMode: Bool
    ) -> CallbackPostRequest? {
        guard let href,
              let body,
              let timeoutMs,
              timeoutMs.isFinite,
              timeoutMs > 0,
              redirect == "manual",
              credentials == "omit",
              CallbackPostRule.acceptsTarget(href, developerMode: developerMode),
              CallbackPostRule.bodyFits(body),
              let bytes = parseAddress(address),
              !CallbackAddressRule.isRefused(bytes, developerMode: developerMode)
        else {
            return nil
        }

        return CallbackPostRequest(href: href, body: body, address: bytes)
    }

    private static func parseAddress(_ address: String?) -> [UInt8]? {
        guard var text = address else { return nil }
        if text.first == "[", text.last == "]" {
            text.removeFirst()
            text.removeLast()
        }

        let family: Int32
        let byteCount: Int
        if text.contains(":") {
            guard text.allSatisfy({ character in
                character.isASCII && (character.isHexDigit || character == ":" || character == ".")
            }) else {
                return nil
            }
            family = AF_INET6
            byteCount = 16
        } else {
            let parts = text.split(separator: ".", omittingEmptySubsequences: false)
            guard parts.count == 4,
                  parts.allSatisfy({ part in
                      (1...3).contains(part.count)
                          && part.allSatisfy({ $0.isASCII && $0.isNumber })
                          && Int(part).map({ $0 <= 255 }) == true
                  })
            else {
                return nil
            }
            family = AF_INET
            byteCount = 4
        }

        var bytes = [UInt8](repeating: 0, count: byteCount)
        let status = bytes.withUnsafeMutableBytes { buffer in
            text.withCString { inet_pton(family, $0, buffer.baseAddress) }
        }
        return status == 1 ? bytes : nil
    }
}
