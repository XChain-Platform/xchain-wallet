// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation
import UserNotifications

final class NotifyActions: NSObject, UNUserNotificationCenterDelegate {
    static let foregroundOptions: UNNotificationPresentationOptions = [.banner, .list, .sound]

    private let readConfig: () -> String?
    private let onAction: ([String: Any]) -> Void

    init(
        readConfig: @escaping () -> String?,
        onAction: @escaping ([String: Any]) -> Void = { _ in }
    ) {
        self.readConfig = readConfig
        self.onAction = onAction
    }

    func register(on center: UNUserNotificationCenter = .current()) {
        center.delegate = self
        center.setNotificationCategories(categories())
    }

    func categories() -> Set<UNNotificationCategory> {
        Set(NotifyCategoryRules.categories(storedTitle: storedTitle()).map { category in
            let actions = category.openOnPhoneTitle.map {
                [UNNotificationAction(
                    identifier: NotifyCategoryRules.openOnPhoneActionId,
                    title: $0,
                    options: [.foreground]
                )]
            } ?? []
            return UNNotificationCategory(
                identifier: category.id,
                actions: actions,
                intentIdentifiers: []
            )
        })
    }

    @discardableResult
    func route(actionId: String, categoryId: String, notificationId: String) -> Bool {
        guard let payload = NotifyActionEvent.payload(
            actionId: actionId,
            categoryId: categoryId,
            notificationId: notificationId
        ) else { return false }
        onAction(payload)
        return true
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler(Self.foregroundOptions)
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let request = response.notification.request
        route(
            actionId: response.actionIdentifier,
            categoryId: request.content.categoryIdentifier,
            notificationId: request.identifier
        )
        completionHandler()
    }

    private func storedTitle() -> String? {
        guard let json = readConfig(),
              let data = json.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return object["openOnPhoneTitle"] as? String
    }
}
