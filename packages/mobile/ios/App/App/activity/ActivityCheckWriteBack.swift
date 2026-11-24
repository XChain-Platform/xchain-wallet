// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

enum ActivityCheckWriteBack {
    static func lastCheckedAt(_ json: String?) -> [String: Int64] {
        guard let object = object(from: json) else {
            return [:]
        }

        var seen: Set<String> = []
        var result: [String: Int64] = [:]
        for value in object["targets"] as? [Any] ?? [] {
            guard
                let target = value as? [String: Any],
                let address = target["address"] as? String,
                seen.insert(address).inserted,
                let number = target["lastCheckedAt"] as? NSNumber,
                CFGetTypeID(number) != CFBooleanGetTypeID()
            else {
                continue
            }

            result[address] = number.int64Value
        }
        return result
    }

    static func baseline(_ config: ActivityCheckConfig) -> [String: [String]] {
        var seen: Set<String> = []
        var result: [String: [String]] = [:]
        for target in config.targets {
            guard
                seen.insert(target.address).inserted,
                let confirmed = target.confirmed,
                let pending = target.pending
            else {
                continue
            }
            result[target.address] = [confirmed, pending]
        }
        return result
    }

    static func updated(
        _ json: String,
        reads: [String: [String]?],
        nowMs: Int64
    ) -> String? {
        guard var object = object(from: json) else {
            return nil
        }

        var targets = object["targets"] as? [Any] ?? []
        var seen: Set<String> = []
        var changed = false
        for index in targets.indices {
            guard
                var target = targets[index] as? [String: Any],
                let address = target["address"] as? String,
                seen.insert(address).inserted,
                let value = reads[address],
                let read = value,
                read.count == 2
            else {
                continue
            }

            target["lastCheckedAt"] = nowMs
            target["confirmed"] = read[0]
            target["pending"] = read[1]
            targets[index] = target
            changed = true
        }

        guard changed else {
            return nil
        }
        object["targets"] = targets
        guard
            let data = try? JSONSerialization.data(
                withJSONObject: object,
                options: [.sortedKeys, .withoutEscapingSlashes]
            )
        else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    private static func object(from json: String?) -> [String: Any]? {
        guard
            let json,
            let data = json.data(using: .utf8),
            let value = try? JSONSerialization.jsonObject(with: data),
            let object = value as? [String: Any]
        else {
            return nil
        }
        return object
    }
}
