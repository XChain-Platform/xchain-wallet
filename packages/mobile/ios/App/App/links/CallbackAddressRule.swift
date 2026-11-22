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

enum CallbackAddressRule {

    static func isRefused(_ address: [UInt8]?, developerMode: Bool) -> Bool {
        guard let address else { return true }
        if address.count == 4 {
            return isIPv4Refused(address, developerMode: developerMode)
        }
        if address.count == 16 {
            return isIPv6Refused(address, developerMode: developerMode)
        }
        return true
    }

    static func refusesAny(_ addresses: [[UInt8]]?, developerMode: Bool) -> Bool {
        guard let addresses, !addresses.isEmpty else { return true }
        return addresses.contains { isRefused($0, developerMode: developerMode) }
    }

    private static func isIPv4Refused(_ address: [UInt8], developerMode: Bool) -> Bool {
        let first = address[0]
        let second = address[1]
        let third = address[2]

        if first == 0 || first == 10 { return true }
        if first == 100 && second >= 64 && second <= 127 { return true }
        if first == 127 { return !developerMode }
        if first == 169 && second == 254 { return true }
        if first == 172 && second >= 16 && second <= 31 { return true }
        if first == 192 && second == 0 && third == 0 { return true }
        if first == 192 && second == 168 { return true }
        if first == 198 && (second == 18 || second == 19) { return true }
        return first >= 224
    }

    private static func isIPv6Refused(_ address: [UInt8], developerMode: Bool) -> Bool {
        if hasZeroPrefix(address, length: 16) { return true }
        if hasZeroPrefix(address, length: 15) && address[15] == 1 {
            return !developerMode
        }
        if hasZeroPrefix(address, length: 12) { return true }
        if hasZeroPrefix(address, length: 10) && address[10] == 255 && address[11] == 255 {
            return true
        }

        let first = address[0]
        let second = address[1]
        if first & 0xfe == 0xfc { return true }
        if first == 0xfe && second & 0xc0 == 0x80 { return true }
        return first == 0xff
    }

    private static func hasZeroPrefix(_ address: [UInt8], length: Int) -> Bool {
        for index in 0..<length where address[index] != 0 {
            return false
        }
        return true
    }
}
