// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

struct NotifyPostArgs: Equatable {
    enum Sound: Equatable {
        case systemDefault
        case silent
        case file(String)
    }

    let id: String
    let title: String
    let body: String
    let family: String
    let sound: Sound
    let category: String?
    let threadId: String

    static let families = [
        "txConfirmations",
        "incomingReceipts",
        "incomingPending",
        "messages",
        "governancePolls",
        "deadlines",
        "dispenserEscrow",
        "dispenserFills",
        "orderFills",
        "priceAlerts",
        "request",
        "paydue",
    ]

    static let soundIds = [
        "chime",
        "glass",
        "bell",
        "pluck",
        "ping",
        "alert",
        "drop",
        "bong",
    ]

    static func parse(_ values: [String: Any]) -> NotifyPostArgs? {
        guard
            let id = values["id"] as? String,
            !id.isEmpty,
            let title = values["title"] as? String,
            !title.isEmpty,
            let family = values["family"] as? String,
            families.contains(family)
        else {
            return nil
        }

        let category: String?
        if let value = values["category"] {
            guard
                let value = value as? String,
                ["request", "paydue", "alert"].contains(value)
            else {
                return nil
            }
            category = value
        } else {
            category = nil
        }

        let sound: Sound
        if let soundId = values["sound"] as? String, soundIds.contains(soundId) {
            sound = .file("\(soundId).caf")
        } else if values["sound"] as? String == "none" {
            sound = .silent
        } else {
            sound = .systemDefault
        }

        return NotifyPostArgs(
            id: id,
            title: title,
            body: values["body"] as? String ?? "",
            family: family,
            sound: sound,
            category: category,
            threadId: values["threadId"] as? String ?? family
        )
    }
}
