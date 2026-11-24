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

struct CallbackPinnedTarget: Equatable {
    let pinnedURL: URL
    let addressText: String
    let port: Int
    let requestTarget: String
    let hostHeader: String
    let serverName: String?

    static func make(href: String?, address: [UInt8]?) -> CallbackPinnedTarget? {
        guard let href,
              let address,
              address.count == 4 || address.count == 16,
              !href.contains("#"),
              let components = URLComponents(string: href),
              components.scheme?.lowercased() == "https",
              components.user == nil,
              components.password == nil,
              components.fragment == nil,
              let parsedHost = components.host,
              !parsedHost.isEmpty,
              let authority = authority(in: href),
              let host = host(in: href, authority: authority),
              let addressText = addressText(for: address)
        else {
            return nil
        }

        let literal = stripBrackets(host.text)
        if let literalAddress = parseLiteral(literal), literalAddress != address {
            return nil
        }

        let replacement = address.count == 16 ? "[\(addressText)]" : addressText
        let pinnedText = href[..<host.range.lowerBound]
            + replacement
            + href[host.range.upperBound...]
        guard let pinnedURL = URL(string: String(pinnedText)) else { return nil }

        let port = host.explicitPort ?? 443
        let rawTarget = href[authority.end...]
        let requestTarget = rawTarget.first == "/" ? String(rawTarget) : "/" + rawTarget
        let hostHeader = host.explicitPort == nil || port == 443
            ? host.text
            : "\(host.text):\(port)"

        return CallbackPinnedTarget(
            pinnedURL: pinnedURL,
            addressText: addressText,
            port: port,
            requestTarget: requestTarget,
            hostHeader: hostHeader,
            serverName: parseLiteral(literal) == nil ? literal.lowercased() : nil
        )
    }

    private static func authority(in href: String) -> (start: String.Index, end: String.Index)? {
        guard let colon = href.firstIndex(of: ":") else { return nil }
        let start = href.index(after: colon)
        guard href[start...].hasPrefix("//") else { return nil }
        let authorityStart = href.index(start, offsetBy: 2)
        let authorityEnd = href[authorityStart...].firstIndex(where: { $0 == "/" || $0 == "?" })
            ?? href.endIndex
        return (authorityStart, authorityEnd)
    }

    private static func host(
        in href: String,
        authority: (start: String.Index, end: String.Index)
    ) -> (range: Range<String.Index>, text: String, explicitPort: Int?)? {
        let value = href[authority.start..<authority.end]
        guard !value.isEmpty, !value.contains("@") else { return nil }

        let hostEnd: String.Index
        let portText: Substring?
        if value.first == "[" {
            guard let close = value.firstIndex(of: "]") else { return nil }
            hostEnd = value.index(after: close)
            let remainder = value[hostEnd...]
            if remainder.isEmpty {
                portText = nil
            } else {
                guard remainder.first == ":" else { return nil }
                portText = remainder.dropFirst()
            }
        } else if let colon = value.lastIndex(of: ":") {
            guard value[..<colon].firstIndex(of: ":") == nil else { return nil }
            hostEnd = colon
            portText = value[value.index(after: colon)...]
        } else {
            hostEnd = authority.end
            portText = nil
        }

        guard hostEnd > authority.start else { return nil }
        let explicitPort: Int?
        if let portText {
            guard !portText.isEmpty,
                  portText.allSatisfy({ $0.isASCII && $0.isNumber }),
                  let parsed = Int(portText),
                  (0...65_535).contains(parsed)
            else {
                return nil
            }
            explicitPort = parsed
        } else {
            explicitPort = nil
        }

        let range = authority.start..<hostEnd
        return (range, String(href[range]), explicitPort)
    }

    private static func stripBrackets(_ host: String) -> String {
        guard host.first == "[", host.last == "]" else { return host }
        return String(host.dropFirst().dropLast())
    }

    private static func parseLiteral(_ text: String) -> [UInt8]? {
        let family = text.contains(":") ? AF_INET6 : AF_INET
        let byteCount = family == AF_INET6 ? 16 : 4
        var bytes = [UInt8](repeating: 0, count: byteCount)
        let status = bytes.withUnsafeMutableBytes { buffer in
            text.withCString { inet_pton(family, $0, buffer.baseAddress) }
        }
        return status == 1 ? bytes : nil
    }

    private static func addressText(for address: [UInt8]) -> String? {
        let family = address.count == 16 ? AF_INET6 : AF_INET
        var buffer = [CChar](repeating: 0, count: Int(INET6_ADDRSTRLEN))
        let result = address.withUnsafeBytes { addressBuffer in
            buffer.withUnsafeMutableBufferPointer { textBuffer in
                inet_ntop(
                    family,
                    addressBuffer.baseAddress,
                    textBuffer.baseAddress,
                    socklen_t(textBuffer.count)
                )
            }
        }
        return result == nil ? nil : String(cString: buffer)
    }
}
