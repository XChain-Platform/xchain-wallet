// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftUI
import UserNotifications
import WatchConnectivity
import WatchKit

@MainActor
final class WatchApplicationDelegate: NSObject, ObservableObject,
    WKApplicationDelegate, @preconcurrency UNUserNotificationCenterDelegate {
    @Published private(set) var request: Request?
    private let pendingRequest: () -> Request?

    override init() {
        pendingRequest = { WatchNotificationSnapshot.latest?.request }
        super.init()
    }

    init(pendingRequest: @escaping () -> Request?) {
        self.pendingRequest = pendingRequest
        super.init()
    }

    func applicationDidFinishLaunching() {
        UNUserNotificationCenter.current().delegate = self
    }

    @discardableResult
    func route(notificationId: String, category: String, actionId: String) -> Bool {
        guard let route = NotificationResponseRoute.resolve(
            notificationId: notificationId,
            category: category,
            actionId: actionId,
            request: pendingRequest()
        ), route.path.last == .alertDetail, let request = route.request else { return false }
        self.request = request
        return true
    }

    func dismissRequest() {
        request = nil
    }

    func openOnPhone(_ request: Request) {
        OpenOnPhone(send: WCSession.default.send)(
            OpenOnPhoneIntent(route: RootView.requestRoute(request.id))
        )
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

@MainActor
private struct NotificationRouteModifier: ViewModifier {
    @ObservedObject var notifications: WatchApplicationDelegate

    func body(content: Content) -> some View {
        content.sheet(isPresented: requestIsPresented) {
            if let request = notifications.request {
                NavigationStack {
                    AlertDetailScreen(request: request) {
                        notifications.openOnPhone(request)
                    }
                }
            }
        }
    }

    private var requestIsPresented: Binding<Bool> {
        Binding(
            get: { notifications.request != nil },
            set: { if !$0 { notifications.dismissRequest() } }
        )
    }
}

@main
struct XChainWatchApp: App {
    @WKApplicationDelegateAdaptor(WatchApplicationDelegate.self) private var appDelegate

    @SceneBuilder
    static var notificationScenes: some Scene {
        WKNotificationScene(controller: AlertNotificationController.self, category: "alert")
        WKNotificationScene(controller: RequestNotificationController.self, category: "request")
        WKNotificationScene(controller: RequestNotificationController.self, category: "paydue")
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .modifier(NotificationRouteModifier(notifications: appDelegate))
        }
        Self.notificationScenes
    }
}
