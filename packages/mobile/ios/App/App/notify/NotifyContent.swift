// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation
import UserNotifications

enum NotifyContent {
    static func content(_ args: NotifyPostArgs) -> UNMutableNotificationContent {
        let content = UNMutableNotificationContent()
        content.title = args.title
        content.body = args.body
        content.threadIdentifier = args.threadId
        content.categoryIdentifier = args.category ?? ""

        switch args.sound {
        case .systemDefault:
            content.sound = UNNotificationSound.default
        case .file(let name):
            content.sound = UNNotificationSound(
                named: UNNotificationSoundName(rawValue: name)
            )
        case .silent:
            content.sound = nil
        }

        return content
    }

    static func request(
        _ args: NotifyPostArgs,
        trigger: UNNotificationTrigger?
    ) -> UNNotificationRequest {
        UNNotificationRequest(
            identifier: args.id,
            content: content(args),
            trigger: trigger
        )
    }
}
