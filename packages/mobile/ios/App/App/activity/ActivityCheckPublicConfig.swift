// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

enum ActivityCheckPublicConfig {
    static func sanitize(_ json: String?) -> String? {
        guard
            let json,
            let data = json.data(using: .utf8),
            let value = try? JSONSerialization.jsonObject(with: data),
            let input = value as? [String: Any],
            let enabled = input["enabled"] as? NSNumber,
            CFGetTypeID(enabled) == CFBooleanGetTypeID(),
            let inputTargets = input["targets"] as? [Any],
            let inputNotice = input["notice"] as? [String: Any],
            let noticeTitle = inputNotice["title"] as? String,
            let noticeBody = inputNotice["body"] as? String,
            let openOnPhoneTitle = input["openOnPhoneTitle"] as? String
        else {
            return nil
        }

        var targets = [[String: String]]()
        for value in inputTargets {
            guard
                let inputTarget = value as? [String: Any],
                let address = inputTarget["address"] as? String,
                let url = inputTarget["url"] as? String,
                let confirmedPath = inputTarget["confirmedPath"] as? String,
                let pendingPath = inputTarget["pendingPath"] as? String
            else {
                return nil
            }

            var target = [
                "address": address,
                "url": url,
                "confirmedPath": confirmedPath,
                "pendingPath": pendingPath,
            ]
            for key in ["confirmed", "pending"] where inputTarget.keys.contains(key) {
                guard let string = inputTarget[key] as? String else {
                    return nil
                }
                target[key] = string
            }
            targets.append(target)
        }

        let output: [String: Any] = [
            "enabled": enabled,
            "targets": targets,
            "notice": [
                "title": noticeTitle,
                "body": noticeBody,
            ],
            "openOnPhoneTitle": openOnPhoneTitle,
        ]
        guard
            let outputData = try? JSONSerialization.data(
                withJSONObject: output,
                options: [.sortedKeys, .withoutEscapingSlashes]
            )
        else {
            return nil
        }

        return String(data: outputData, encoding: .utf8)
    }
}
