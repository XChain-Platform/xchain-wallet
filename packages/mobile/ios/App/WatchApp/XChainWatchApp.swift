// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftUI
import UserNotifications
import WatchKit

struct WatchNotificationResponse: Equatable {
    let notificationId: String
    let category: String
    let actionId: String
}

@MainActor
final class WatchApplicationDelegate: NSObject, ObservableObject,
    WKApplicationDelegate, @preconcurrency UNUserNotificationCenterDelegate {
    @Published private(set) var response: WatchNotificationResponse?

    func applicationDidFinishLaunching() {
        UNUserNotificationCenter.current().delegate = self
    }

    @discardableResult
    func route(notificationId: String, category: String, actionId: String) -> Bool {
        guard NotificationSceneRules.responsePath(category: category, actionId: actionId) != nil else {
            return false
        }
        response = WatchNotificationResponse(
            notificationId: notificationId,
            category: category,
            actionId: actionId
        )
        return true
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let request = response.notification.request
        route(
            notificationId: request.identifier,
            category: request.content.categoryIdentifier,
            actionId: response.actionIdentifier
        )
        completionHandler()
    }
}

@MainActor
struct NotificationRoutingRootView: View {
    @ObservedObject var notifications: WatchApplicationDelegate
    @StateObject private var model: RootViewModel
    @State private var path = NavigationPath()

    init(notifications: WatchApplicationDelegate) {
        self.notifications = notifications
        _model = StateObject(wrappedValue: RootViewModel.live())
    }

    static func path(
        for response: WatchNotificationResponse,
        pendingRequest: Request?
    ) -> [WatchScreen]? {
        guard let path = NotificationSceneRules.responsePath(
            category: response.category,
            actionId: response.actionId
        ) else { return nil }
        guard path.last == .alertDetail else { return path }
        return NotificationRequestLookup.pendingRequest(
            notificationId: response.notificationId,
            category: response.category,
            request: pendingRequest
        ) == nil ? [.balances] : path
    }

    var body: some View {
        AmbientRedaction(
            phoneHidden: model.snapshot?.hidden ?? false,
            hideAmounts: model.hideAmounts
        ) { redaction in
            NavigationStack(path: $path) {
                RootContent(model: model, redaction: redaction) {
                    path.append($0)
                }
            }
        }
        .task { model.activate() }
        .onReceive(notifications.$response) { response in
            guard let response,
                  let route = Self.path(for: response, pendingRequest: model.snapshot?.request)
            else { return }
            path = NavigationPath()
            for screen in route.dropFirst() {
                path.append(screen)
            }
        }
    }
}

private enum WatchNotificationSnapshot {
    static var latest: Snapshot? {
        let base = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0].appendingPathComponent("WatchApp/snapshots", isDirectory: true)
        return SnapshotStore(directory: base).latest
    }
}

@MainActor
final class AlertNotificationController: WKUserNotificationHostingController<AnyView> {
    private var notificationId = ""

    override func didReceive(_ notification: UNNotification) {
        notificationId = notification.request.identifier
    }

    override var body: AnyView {
        guard let item = WatchNotificationSnapshot.latest?.inbox.first(where: {
            $0.id == notificationId
        }) else { return AnyView(EmptyView()) }
        return AnyView(AlertLongLook(item: item))
    }
}

@MainActor
final class RequestNotificationController: WKUserNotificationHostingController<AnyView> {
    private var notificationId = ""
    private var category = ""

    override func didReceive(_ notification: UNNotification) {
        notificationId = notification.request.identifier
        category = notification.request.content.categoryIdentifier
    }

    override var body: AnyView {
        guard let request = NotificationRequestLookup.pendingRequest(
            notificationId: notificationId,
            category: category,
            request: WatchNotificationSnapshot.latest?.request
        ) else { return AnyView(EmptyView()) }
        return AnyView(RequestLongLook(request: request) { [weak self] in
            self?.performNotificationDefaultAction()
        })
    }
}

@main
struct XChainWatchApp: App {
    @WKApplicationDelegateAdaptor(WatchApplicationDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            NotificationRoutingRootView(notifications: appDelegate)
        }
        WKNotificationScene(controller: AlertNotificationController.self, category: "alert")
        WKNotificationScene(controller: RequestNotificationController.self, category: "request")
        WKNotificationScene(controller: RequestNotificationController.self, category: "paydue")
    }
}
