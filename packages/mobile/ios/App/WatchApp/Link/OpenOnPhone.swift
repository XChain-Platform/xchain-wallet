// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

struct OpenOnPhone {
    private let send: ([String: Any]) -> Void

    init(send: @escaping ([String: Any]) -> Void) {
        self.send = send
    }

    func callAsFunction(_ intent: OpenOnPhoneIntent) {
        guard let activity = Self.userActivity(for: intent),
              let message = PhoneIntentMessage.message(kind: "openOnPhone", value: intent) else {
            return
        }

        activity.becomeCurrent()
        send(message)
    }

    static func userActivity(for intent: OpenOnPhoneIntent) -> NSUserActivity? {
        guard let userInfo = ViewActivity.userInfo(for: intent) else {
            return nil
        }

        let activity = NSUserActivity(activityType: ViewActivity.activityType)
        activity.userInfo = userInfo
        return activity
    }
}
