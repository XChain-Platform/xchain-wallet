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

enum BrowserReturnHint {

    static func candidates(url text: String, browser: String?) -> [URL] {
        guard let url = URL(string: text),
              let scheme = url.scheme,
              scheme.caseInsensitiveCompare("https") == .orderedSame,
              url.host?.isEmpty == false,
              url.user == nil,
              url.password == nil
        else {
            return []
        }

        let hintedURL: URL?
        switch browser {
        case "chrome":
            hintedURL = replacingScheme(in: text, with: "googlechromes")
        case "edge":
            hintedURL = replacingScheme(in: text, with: "microsoft-edge-https")
        case "firefox":
            hintedURL = URL(string: "firefox://open-url?url=\(percentEncode(text))")
        default:
            hintedURL = nil
        }

        return hintedURL.map { [$0, url] } ?? [url]
    }

    private static func replacingScheme(in url: String, with replacement: String) -> URL? {
        guard let separator = url.firstIndex(of: ":") else { return nil }
        return URL(string: replacement + url[separator...])
    }

    private static func percentEncode(_ value: String) -> String {
        let hexadecimal = Array("0123456789ABCDEF".utf8)
        var encoded: [UInt8] = []
        encoded.reserveCapacity(value.utf8.count * 3)

        for byte in value.utf8 {
            if byte >= 65 && byte <= 90
                || byte >= 97 && byte <= 122
                || byte >= 48 && byte <= 57
                || byte == 45 || byte == 46 || byte == 95 || byte == 126
            {
                encoded.append(byte)
            } else {
                encoded.append(37)
                encoded.append(hexadecimal[Int(byte >> 4)])
                encoded.append(hexadecimal[Int(byte & 15)])
            }
        }

        return String(decoding: encoded, as: UTF8.self)
    }
}
