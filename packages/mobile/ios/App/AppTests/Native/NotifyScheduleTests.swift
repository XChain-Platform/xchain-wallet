// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import UserNotifications
import XCTest
@testable import App

private final class FakeNotifyScheduleCenter: NotifyScheduleCenter {
    var requests: [UNNotificationRequest]
    var added: [UNNotificationRequest] = []
    var cancelled: [[String]] = []
    var addError: Error?
    var holdPending = false
    private var pendingCompletions: [() -> Void] = []

    init(requests: [UNNotificationRequest] = []) {
        self.requests = requests
    }

    func pending(_ completion: @escaping ([UNNotificationRequest]) -> Void) {
        let snapshot = requests
        if holdPending {
            pendingCompletions.append { completion(snapshot) }
        } else {
            completion(snapshot)
        }
    }

    func add(_ request: UNNotificationRequest, completion: @escaping (Error?) -> Void) {
        if addError == nil {
            added.append(request)
            requests.removeAll { $0.identifier == request.identifier }
            requests.append(request)
        }
        completion(addError)
    }

    func cancel(ids: [String]) {
        cancelled.append(ids)
        requests.removeAll { ids.contains($0.identifier) }
    }

    func releasePending() {
        holdPending = false
        let completions = pendingCompletions
        pendingCompletions.removeAll()
        completions.forEach { $0() }
    }
}

final class NotifyScheduleTests: XCTestCase {
    private let nowMs: Int64 = 1_700_000_000_000

    private func request(_ id: String) -> UNNotificationRequest {
        UNNotificationRequest(
            identifier: id,
            content: UNMutableNotificationContent(),
            trigger: nil
        )
    }

    private func schedule(
        _ scheduler: NotifySchedule,
        id: String = "deadline:order-1",
        atMs: Int64? = nil,
        content: UNMutableNotificationContent = UNMutableNotificationContent()
    ) -> Bool {
        let done = expectation(description: "schedule completes")
        var accepted = false
        scheduler.schedule(id: id, atMs: atMs ?? nowMs + 60_000, content: content) {
            accepted = $0
            done.fulfill()
        }
        wait(for: [done], timeout: 2)
        return accepted
    }

    func testSchedulesOneShotRequestWithContentAndInterval() throws {
        let center = FakeNotifyScheduleCenter()
        let scheduler = NotifySchedule(center: center, nowMs: { self.nowMs })
        let content = UNMutableNotificationContent()
        content.title = "Order deadline"
        content.body = "Review the order"
        content.threadIdentifier = "deadlines"

        XCTAssertTrue(schedule(scheduler, content: content))
        let added = try XCTUnwrap(center.added.first)
        XCTAssertEqual(added.identifier, "deadline:order-1")
        XCTAssertEqual(added.content.title, "Order deadline")
        XCTAssertEqual(added.content.body, "Review the order")
        XCTAssertEqual(added.content.threadIdentifier, "deadlines")
        let trigger = try XCTUnwrap(added.trigger as? UNTimeIntervalNotificationTrigger)
        XCTAssertEqual(trigger.timeInterval, 60)
        XCTAssertFalse(trigger.repeats)
    }

    func testPastDeadlineUsesMinimumInterval() throws {
        let center = FakeNotifyScheduleCenter()
        let scheduler = NotifySchedule(center: center, nowMs: { self.nowMs })

        XCTAssertTrue(schedule(scheduler, atMs: nowMs - 60_000))
        let trigger = try XCTUnwrap(center.added.first?.trigger as? UNTimeIntervalNotificationTrigger)
        XCTAssertEqual(trigger.timeInterval, 1)
    }

    func testRefusesNewIdAtPendingLimitButReplacesExistingId() {
        let pending = (0..<NotifyScheduleRules.maxPending).map { request("deadline:\($0)") }
        let center = FakeNotifyScheduleCenter(requests: pending)
        let scheduler = NotifySchedule(center: center, nowMs: { self.nowMs })

        XCTAssertFalse(schedule(scheduler, id: "deadline:new"))
        XCTAssertTrue(center.added.isEmpty)
        XCTAssertTrue(schedule(scheduler, id: "deadline:0"))
        XCTAssertEqual(center.added.map(\.identifier), ["deadline:0"])
    }

    func testAddFailureIsRefusedAndReleasesCapacity() {
        struct Failure: Error {}
        let pending = (0..<(NotifyScheduleRules.maxPending - 1)).map { request("deadline:\($0)") }
        let center = FakeNotifyScheduleCenter(requests: pending)
        let scheduler = NotifySchedule(center: center, nowMs: { self.nowMs })
        center.addError = Failure()

        XCTAssertFalse(schedule(scheduler, id: "deadline:first"))
        center.addError = nil
        XCTAssertTrue(schedule(scheduler, id: "deadline:second"))
    }

    func testConcurrentSchedulesStillAdmitOnlyFortyEightIds() {
        let center = FakeNotifyScheduleCenter()
        center.holdPending = true
        let scheduler = NotifySchedule(center: center, nowMs: { self.nowMs })
        var results: [Bool] = []
        let done = expectation(description: "all schedules complete")
        done.expectedFulfillmentCount = NotifyScheduleRules.maxPending + 1

        for index in 0...NotifyScheduleRules.maxPending {
            scheduler.schedule(
                id: "deadline:\(index)",
                atMs: nowMs + 60_000,
                content: UNMutableNotificationContent()
            ) {
                results.append($0)
                done.fulfill()
            }
        }
        center.releasePending()
        wait(for: [done], timeout: 2)

        XCTAssertEqual(results.filter { $0 }.count, NotifyScheduleRules.maxPending)
        XCTAssertEqual(results.filter { !$0 }.count, 1)
        XCTAssertEqual(center.added.count, NotifyScheduleRules.maxPending)
    }

    func testCancelRemovesOnlyRequestedId() {
        let center = FakeNotifyScheduleCenter(requests: [request("deadline:one"), request("deadline:two")])
        let scheduler = NotifySchedule(center: center, nowMs: { self.nowMs })

        scheduler.cancel(id: "deadline:one")

        XCTAssertEqual(center.cancelled, [["deadline:one"]])
        XCTAssertEqual(center.requests.map(\.identifier), ["deadline:two"])
    }
}
