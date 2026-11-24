// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Combine
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
final class NotificationNavigation: ObservableObject {
    @Published var path: [WatchScreen] = []
    private let pendingRequest: () -> Request?
    private var responseSubscription: AnyCancellable?

    init(
        notifications: WatchApplicationDelegate,
        pendingRequest: @escaping () -> Request?
    ) {
        self.pendingRequest = pendingRequest
        responseSubscription = notifications.$response
            .compactMap { $0 }
            .sink { [weak self] in self?.route($0) }
    }

    private func route(_ response: WatchNotificationResponse) {
        guard let route = Self.path(
            for: response,
            pendingRequest: pendingRequest()
        ) else { return }
        path = Array(route.dropFirst())
    }

    func open(_ screen: WatchScreen) {
        path.append(screen)
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
}

@MainActor
struct NotificationRoutingRootView: View {
    @StateObject private var model: RootViewModel
    @StateObject var navigation: NotificationNavigation

    init(
        notifications: WatchApplicationDelegate,
        pendingRequest: (() -> Request?)? = nil
    ) {
        let model = RootViewModel.live()
        _model = StateObject(wrappedValue: model)
        _navigation = StateObject(wrappedValue: NotificationNavigation(
            notifications: notifications,
            pendingRequest: pendingRequest ?? { [weak model] in model?.snapshot?.request }
        ))
    }

    var body: some View {
        AmbientRedaction(
            phoneHidden: model.snapshot?.hidden ?? false,
            hideAmounts: model.hideAmounts
        ) { redaction in
            NavigationStack(path: $navigation.path) {
                RootContent(model: model, redaction: redaction) {
                    navigation.open($0)
                }
            }
        }
        .task { model.activate() }
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

    @SceneBuilder
    static var notificationScenes: some Scene {
        WKNotificationScene(controller: AlertNotificationController.self, category: "alert")
        WKNotificationScene(controller: RequestNotificationController.self, category: "request")
        WKNotificationScene(controller: RequestNotificationController.self, category: "paydue")
    }

    var body: some Scene {
        WindowGroup {
            NotificationRoutingRootView(notifications: appDelegate)
        }
        Self.notificationScenes
    }
}
