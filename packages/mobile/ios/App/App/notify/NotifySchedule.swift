// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation
import UserNotifications

protocol NotifyScheduleCenter: AnyObject {
    func pending(_ completion: @escaping ([UNNotificationRequest]) -> Void)
    func add(_ request: UNNotificationRequest, completion: @escaping (Error?) -> Void)
    func cancel(ids: [String])
}

extension UNUserNotificationCenter: NotifyScheduleCenter {
    func pending(_ completion: @escaping ([UNNotificationRequest]) -> Void) {
        getPendingNotificationRequests(completionHandler: completion)
    }

    func add(_ request: UNNotificationRequest, completion: @escaping (Error?) -> Void) {
        add(request, withCompletionHandler: completion)
    }

    func cancel(ids: [String]) {
        removePendingNotificationRequests(withIdentifiers: ids)
    }
}

final class NotifySchedule {
    private let center: NotifyScheduleCenter
    private let nowMs: () -> Int64
    private let lock = NSLock()
    private var tasks: [() -> Void] = []
    private var running = false

    init(
        center: NotifyScheduleCenter = UNUserNotificationCenter.current(),
        nowMs: @escaping () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1_000) }
    ) {
        self.center = center
        self.nowMs = nowMs
    }

    func schedule(
        id: String,
        atMs: Int64,
        content: UNNotificationContent,
        completion: @escaping (Bool) -> Void
    ) {
        enqueue { [self] in
            center.pending { [self] requests in
                let pendingIds = Set(requests.map(\.identifier))
                guard NotifyScheduleRules.admits(pendingIds: pendingIds, id: id) else {
                    completion(false)
                    finish()
                    return
                }

                let interval = NotifyScheduleRules.timeInterval(atMs: atMs, nowMs: nowMs())
                let trigger = UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
                let request = UNNotificationRequest(identifier: id, content: content, trigger: trigger)
                center.add(request) { error in
                    completion(error == nil)
                    self.finish()
                }
            }
        }
    }

    func cancel(id: String) {
        enqueue { [self] in
            center.cancel(ids: [id])
            finish()
        }
    }

    private func enqueue(_ task: @escaping () -> Void) {
        var next: (() -> Void)?
        lock.lock()
        tasks.append(task)
        if !running {
            running = true
            next = tasks.removeFirst()
        }
        lock.unlock()
        next?()
    }

    private func finish() {
        var next: (() -> Void)?
        lock.lock()
        if tasks.isEmpty {
            running = false
        } else {
            next = tasks.removeFirst()
        }
        lock.unlock()
        next?()
    }
}
