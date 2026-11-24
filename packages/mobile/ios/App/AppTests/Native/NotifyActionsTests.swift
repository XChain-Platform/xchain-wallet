// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import UserNotifications
import XCTest
@testable import App

final class NotifyActionsTests: XCTestCase {
    private var directory: URL!
    private var files: ActivityCheckFiles!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("NotifyActionsTests-\(UUID().uuidString)")
        files = ActivityCheckFiles(directory: directory)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
        directory = nil
        files = nil
    }

    func testOpenOnPhoneActionFollowsStoredConfigAndClear() throws {
        let actions = NotifyActions(readConfig: files.readConfig)
        assertActionTitles(actions.categories(), expected: nil)

        try files.writeConfig(#"{"openOnPhoneTitle":"  Open on phone\n","enabled":true}"#)
        XCTAssertEqual(files.readConfig(), #"{"openOnPhoneTitle":"  Open on phone\n","enabled":true}"#)
        assertActionTitles(actions.categories(), expected: "Open on phone")

        XCTAssertTrue(files.clear())
        assertActionTitles(actions.categories(), expected: nil)
    }

    func testInvalidConfigLeavesActionsOff() throws {
        try files.writeConfig("not-json")
        assertActionTitles(NotifyActions(readConfig: files.readConfig).categories(), expected: nil)
    }

    func testRoutesOnlyOpenOnPhoneActions() {
        var events: [[String: Any]] = []
        let actions = NotifyActions(readConfig: files.readConfig) { events.append($0) }

        XCTAssertTrue(actions.route(
            actionId: NotifyCategoryRules.openOnPhoneActionId,
            categoryId: NotifyCategoryRules.requestCategoryId,
            notificationId: "request-1"
        ))
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(Set(events[0].keys), Set(["action", "id"]))
        XCTAssertEqual(events[0]["action"] as? String, "openOnPhone")
        XCTAssertEqual(events[0]["id"] as? String, "request-1")

        XCTAssertTrue(actions.route(
            actionId: NotifyCategoryRules.openOnPhoneActionId,
            categoryId: NotifyCategoryRules.paydueCategoryId,
            notificationId: "paydue-1"
        ))
        XCTAssertEqual(events[1]["action"] as? String, "openOnPhone")
        XCTAssertEqual(events[1]["id"] as? String, "paydue-1")

        XCTAssertFalse(actions.route(
            actionId: UNNotificationDefaultActionIdentifier,
            categoryId: NotifyCategoryRules.requestCategoryId,
            notificationId: "request-1"
        ))
        XCTAssertFalse(actions.route(
            actionId: NotifyCategoryRules.openOnPhoneActionId,
            categoryId: NotifyCategoryRules.alertCategoryId,
            notificationId: "alert-1"
        ))
        XCTAssertFalse(actions.route(
            actionId: NotifyCategoryRules.openOnPhoneActionId,
            categoryId: NotifyCategoryRules.requestCategoryId,
            notificationId: ""
        ))
        XCTAssertEqual(events.count, 2)
    }

    func testForegroundNotificationsShowAlerts() {
        XCTAssertEqual(NotifyActions.foregroundOptions, [.banner, .list, .sound])
    }

    private func assertActionTitles(
        _ categories: Set<UNNotificationCategory>,
        expected: String?,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let byId = Dictionary(uniqueKeysWithValues: categories.map { ($0.identifier, $0) })
        XCTAssertEqual(
            Set(byId.keys),
            Set([
                NotifyCategoryRules.requestCategoryId,
                NotifyCategoryRules.paydueCategoryId,
                NotifyCategoryRules.alertCategoryId,
            ]),
            file: file,
            line: line
        )
        for id in [NotifyCategoryRules.requestCategoryId, NotifyCategoryRules.paydueCategoryId] {
            let category = byId[id]
            XCTAssertEqual(category?.actions.first?.title, expected, file: file, line: line)
            XCTAssertEqual(category?.actions.count, expected == nil ? 0 : 1, file: file, line: line)
            if expected != nil {
                XCTAssertEqual(
                    category?.actions.first?.identifier,
                    NotifyCategoryRules.openOnPhoneActionId,
                    file: file,
                    line: line
                )
                XCTAssertTrue(
                    category?.actions.first?.options.contains(.foreground) == true,
                    file: file,
                    line: line
                )
            }
        }
        XCTAssertEqual(byId[NotifyCategoryRules.alertCategoryId]?.actions.count, 0, file: file, line: line)
    }
}
