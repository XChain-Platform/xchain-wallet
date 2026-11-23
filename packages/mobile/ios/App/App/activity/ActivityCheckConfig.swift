// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

struct ActivityCheckConfig: Equatable {
    struct Target: Equatable {
        let address: String
        let url: String
        let confirmedPath: String
        let pendingPath: String
        let confirmed: String?
        let pending: String?
    }

    let enabled: Bool
    let targets: [Target]
    let noticeTitle: String?
    let noticeBody: String?
    let openOnPhoneTitle: String?

    var isRunnable: Bool {
        enabled && !targets.isEmpty
    }

    var addresses: [String] {
        targets.map(\.address)
    }

    static func decode(_ json: String?) -> ActivityCheckConfig? {
        guard
            let json,
            let data = json.data(using: .utf8),
            let value = try? JSONSerialization.jsonObject(with: data),
            let object = value as? [String: Any]
        else {
            return nil
        }

        let targets = (object["targets"] as? [Any])?.compactMap(target(from:)) ?? []
        let notice = object["notice"] as? [String: Any]

        return ActivityCheckConfig(
            enabled: booleanTrue(object["enabled"]),
            targets: targets,
            noticeTitle: nonEmptyString(notice?["title"]),
            noticeBody: nonEmptyString(notice?["body"]),
            openOnPhoneTitle: nonEmptyString(object["openOnPhoneTitle"])
        )
    }

    private static func target(from value: Any) -> Target? {
        guard
            let object = value as? [String: Any],
            let address = object["address"] as? String,
            !address.isEmpty,
            let url = object["url"] as? String,
            !url.isEmpty,
            let confirmedPath = object["confirmedPath"] as? String,
            !confirmedPath.isEmpty,
            let pendingPath = object["pendingPath"] as? String,
            !pendingPath.isEmpty
        else {
            return nil
        }

        return Target(
            address: address,
            url: url,
            confirmedPath: confirmedPath,
            pendingPath: pendingPath,
            confirmed: object["confirmed"] as? String,
            pending: object["pending"] as? String
        )
    }

    private static func booleanTrue(_ value: Any?) -> Bool {
        guard
            let number = value as? NSNumber,
            CFGetTypeID(number) == CFBooleanGetTypeID()
        else {
            return false
        }

        return number.boolValue
    }

    private static func nonEmptyString(_ value: Any?) -> String? {
        guard
            let string = value as? String,
            !string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            return nil
        }

        return string
    }
}
