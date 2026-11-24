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

enum CallbackHostAnswer {

    static func addresses(host: String?, lookup: CallbackResolve.Lookup) -> [String]? {
        guard let host else { return nil }
        var lookupHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !lookupHost.isEmpty else { return nil }

        if lookupHost.first == "[", lookupHost.last == "]" {
            lookupHost.removeFirst()
            lookupHost.removeLast()
        }

        guard let addresses = lookup(lookupHost), !addresses.isEmpty else {
            return nil
        }
        guard addresses.allSatisfy({ $0.count == 4 || $0.count == 16 }) else {
            return nil
        }

        return addresses.map { address in
            if address.count == 4 {
                return address.map(String.init).joined(separator: ".")
            }

            return stride(from: 0, to: address.count, by: 2).map { index in
                let word = UInt16(address[index]) << 8 | UInt16(address[index + 1])
                return String(word, radix: 16)
            }.joined(separator: ":")
        }
    }
}
