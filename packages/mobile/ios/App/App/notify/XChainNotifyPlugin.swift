// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Capacitor
import UserNotifications

@objc(XChainNotifyPlugin)
public class XChainNotifyPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "XChainNotifyPlugin"
    public let jsName = "XChainNotify"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "permissionState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "post", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "schedule", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelAll", returnType: CAPPluginReturnPromise),
    ]

    var scheduler = NotifySchedule()

    @objc func post(_ call: CAPPluginCall) {
        guard let args = NotifyPostArgs.parse(call.options as? [String: Any] ?? [:]) else {
            call.reject("post arguments are invalid")
            return
        }
        UNUserNotificationCenter.current().add(NotifyContent.request(args, trigger: nil)) {
            if let error = $0 {
                call.reject("post failed", nil, error)
            } else {
                call.resolve(["posted": true])
            }
        }
    }

    @objc func schedule(_ call: CAPPluginCall) {
        guard let args = NotifyScheduleArgs.parse(call.options as? [String: Any] ?? [:]) else {
            call.reject("schedule arguments are invalid")
            return
        }
        scheduler.schedule(
            id: args.post.id,
            atMs: args.atMs,
            content: NotifyContent.content(args.post)
        ) { scheduled in
            call.resolve(["scheduled": scheduled])
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        guard let id = NotifyScheduleArgs.cancelId(call.options as? [String: Any] ?? [:]) else {
            call.reject("cancel arguments are invalid")
            return
        }
        scheduler.cancel(id: id)
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [id])
        call.resolve(["cancelled": true])
    }

    @objc func cancelAll(_ call: CAPPluginCall) {
        let center = UNUserNotificationCenter.current()
        center.removeAllPendingNotificationRequests()
        center.removeAllDeliveredNotifications()
        call.resolve()
    }

    @objc func permissionState(_ call: CAPPluginCall) {
        resolvePermission(call)
    }

    @objc func requestPermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(
            options: NotifyPermission.requestOptions
        ) { _, _ in
            self.resolvePermission(call)
        }
    }

    private func resolvePermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            call.resolve(NotifyPermission.reply(settings.authorizationStatus))
        }
    }
}
