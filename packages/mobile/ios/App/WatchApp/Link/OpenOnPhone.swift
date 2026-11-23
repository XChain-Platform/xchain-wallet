// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

struct OpenOnPhone {
    private let send: ([String: Any]) -> Void
    private let makeActivity: (OpenOnPhoneIntent) -> NSUserActivity?

    init(send: @escaping ([String: Any]) -> Void) {
        self.init(send: send, makeActivity: Self.userActivity)
    }

    init(
        send: @escaping ([String: Any]) -> Void,
        makeActivity: @escaping (OpenOnPhoneIntent) -> NSUserActivity?
    ) {
        self.send = send
        self.makeActivity = makeActivity
    }

    func callAsFunction(_ intent: OpenOnPhoneIntent) {
        guard let activity = makeActivity(intent),
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
