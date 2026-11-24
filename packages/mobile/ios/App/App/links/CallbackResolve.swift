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

enum CallbackResolve {

    typealias Lookup = (String) -> [[UInt8]]?

    enum Outcome: Equatable {
        case address([UInt8])
        case resolveFailed
        case refusedAddress
    }

    static func systemLookup(_ host: String) -> [[UInt8]]? {
        var hints = addrinfo()
        hints.ai_family = AF_UNSPEC
        hints.ai_socktype = SOCK_STREAM

        var list: UnsafeMutablePointer<addrinfo>?
        let status = getaddrinfo(host, nil, &hints, &list)
        defer {
            if let list {
                freeaddrinfo(list)
            }
        }
        guard status == 0 else { return nil }

        var addresses: [[UInt8]] = []
        var current = list
        while let entry = current {
            let info = entry.pointee
            if let socketAddress = info.ai_addr {
                switch info.ai_family {
                case AF_INET:
                    var address = socketAddress.withMemoryRebound(
                        to: sockaddr_in.self,
                        capacity: 1
                    ) { $0.pointee.sin_addr }
                    addresses.append(withUnsafeBytes(of: &address) { Array($0) })
                case AF_INET6:
                    var address = socketAddress.withMemoryRebound(
                        to: sockaddr_in6.self,
                        capacity: 1
                    ) { $0.pointee.sin6_addr }
                    addresses.append(withUnsafeBytes(of: &address) { Array($0) })
                default:
                    break
                }
            }
            current = info.ai_next
        }
        return addresses
    }

    static func check(host: String?, developerMode: Bool, lookup: Lookup) -> Outcome {
        guard let host else { return .resolveFailed }
        var lookupHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !lookupHost.isEmpty else { return .resolveFailed }

        if lookupHost.first == "[", lookupHost.last == "]" {
            lookupHost.removeFirst()
            lookupHost.removeLast()
        }

        guard let addresses = lookup(lookupHost), !addresses.isEmpty else {
            return .resolveFailed
        }
        guard !CallbackAddressRule.refusesAny(addresses, developerMode: developerMode) else {
            return .refusedAddress
        }
        return .address(addresses[0])
    }
}
