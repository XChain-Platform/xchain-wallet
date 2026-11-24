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

enum CallbackHttpWire {
    static let maxHeadBytes = 8192

    enum Head: Equatable {
        case incomplete
        case status(Int)
        case malformed
    }

    static func requestData(target: CallbackPinnedTarget, body: String) -> Data? {
        guard CallbackPostRule.bodyFits(body),
              isToken(target.requestTarget),
              isToken(target.hostHeader)
        else {
            return nil
        }

        let head = [
            "POST \(target.requestTarget) HTTP/1.1",
            "Host: \(target.hostHeader)",
            "Content-Type: application/json",
            "Content-Length: \(body.utf8.count)",
            "Connection: close",
        ].joined(separator: "\r\n") + "\r\n\r\n"

        var request = Data(head.utf8)
        request.append(contentsOf: body.utf8)
        return request
    }

    static func parseHead(_ data: Data) -> Head {
        let bytes = [UInt8](data)
        var start = 0

        while true {
            guard let terminator = headTerminator(in: bytes, from: start) else {
                return bytes.count - start > maxHeadBytes ? .malformed : .incomplete
            }

            let end = terminator + 4
            guard end - start <= maxHeadBytes,
                  let lineEnd = lineEnd(in: bytes, from: start, through: terminator),
                  let status = status(in: bytes[start..<lineEnd])
            else {
                return .malformed
            }

            if (100...199).contains(status) {
                start = end
                continue
            }
            return .status(status)
        }
    }

    private static func isToken(_ value: String) -> Bool {
        !value.isEmpty && value.unicodeScalars.allSatisfy { (33...126).contains($0.value) }
    }

    private static func headTerminator(in bytes: [UInt8], from start: Int) -> Int? {
        guard bytes.count - start >= 4 else { return nil }
        for index in start...(bytes.count - 4) where bytes[index...index + 3] == [13, 10, 13, 10] {
            return index
        }
        return nil
    }

    private static func lineEnd(in bytes: [UInt8], from start: Int, through end: Int) -> Int? {
        for index in start...end where bytes[index] == 13 && bytes[index + 1] == 10 {
            return index
        }
        return nil
    }

    private static func status(in line: ArraySlice<UInt8>) -> Int? {
        let bytes = Array(line)
        let http11 = Array("HTTP/1.1 ".utf8)
        let http10 = Array("HTTP/1.0 ".utf8)
        guard bytes.starts(with: http11) || bytes.starts(with: http10),
              bytes.count >= 12,
              bytes[9...11].allSatisfy({ (48...57).contains($0) }),
              bytes.count == 12 || bytes[12] == 32
        else {
            return nil
        }

        let value = Int(bytes[9] - 48) * 100
            + Int(bytes[10] - 48) * 10
            + Int(bytes[11] - 48)
        return (100...599).contains(value) ? value : nil
    }
}
