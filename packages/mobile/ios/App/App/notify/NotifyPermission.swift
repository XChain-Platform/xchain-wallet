// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation
import UserNotifications

enum NotifyPermission {
    static let requestOptions: UNAuthorizationOptions = [.alert, .sound]

    static func state(_ status: UNAuthorizationStatus) -> String {
        switch status {
        case .notDetermined, .provisional:
            return "prompt"
        case .denied:
            return "denied"
        default:
            return "granted"
        }
    }

    static func reply(_ status: UNAuthorizationStatus) -> [String: Any] {
        ["state": state(status)]
    }
}
