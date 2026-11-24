// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import BackgroundTasks
import Foundation
import UserNotifications

protocol BackgroundTaskScheduling {
    func register(
        forTaskWithIdentifier identifier: String,
        using queue: DispatchQueue?,
        launchHandler: @escaping (BGTask) -> Void
    ) -> Bool
    func submit(_ taskRequest: BGTaskRequest) throws
}

extension BGTaskScheduler: BackgroundTaskScheduling {}

private struct ActivityNotificationCenterPoster: ActivityNoticePosting {
    func post(_ notice: NotifyPostArgs) {
        UNUserNotificationCenter.current().add(NotifyContent.request(notice, trigger: nil))
    }
}

final class BackgroundActivityCheck {
    typealias DataLoader = @Sendable (URLRequest) async throws -> (Data, URLResponse)

    static let taskIdentifier = "io.xchain.wallet.ios.activity-check"
    static let repeatInterval: TimeInterval = 21_600

    private let files: ActivityCheckFiles
    private let poster: ActivityNoticePosting
    private let now: () -> Date
    private let load: DataLoader

    init(
        directory: URL,
        poster: ActivityNoticePosting = ActivityNotificationCenterPoster(),
        now: @escaping () -> Date = Date.init,
        load: DataLoader? = nil
    ) {
        files = ActivityCheckFiles(directory: directory)
        self.poster = poster
        self.now = now
        if let load {
            self.load = load
        } else {
            let session = URLSession(configuration: Self.sessionConfiguration())
            self.load = { try await session.data(for: $0) }
        }
    }

    @discardableResult
    static func register(
        _ suppliedCheck: BackgroundActivityCheck? = nil,
        scheduler: BackgroundTaskScheduling = BGTaskScheduler.shared
    ) -> Bool {
        guard let check = suppliedCheck ?? defaultCheck() else { return false }
        let registered = scheduler.register(
            forTaskWithIdentifier: taskIdentifier,
            using: nil
        ) { task in
            guard let refreshTask = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            check.schedule(on: scheduler)
            let operation = Task {
                _ = await check.runOnce()
                refreshTask.setTaskCompleted(success: !Task.isCancelled)
            }
            refreshTask.expirationHandler = { operation.cancel() }
        }
        if registered { check.schedule(on: scheduler) }
        return registered
    }

    func schedule(on scheduler: BackgroundTaskScheduling = BGTaskScheduler.shared) {
        let request = BGAppRefreshTaskRequest(identifier: Self.taskIdentifier)
        request.earliestBeginDate = now().addingTimeInterval(Self.repeatInterval)
        try? scheduler.submit(request)
    }

    @discardableResult
    func runOnce() async -> Bool {
        guard
            let json = files.readConfig(),
            let config = ActivityCheckConfig.decode(json),
            config.isRunnable
        else {
            return false
        }

        var targets: [String: ActivityCheckConfig.Target] = [:]
        for target in config.targets where targets[target.address] == nil {
            targets[target.address] = target
        }
        let selectedTargets = targets
        let loader = load
        let reads = await ActivityCheckBudget.run(
            config.addresses,
            lastCheckedAt: ActivityCheckWriteBack.lastCheckedAt(json)
        ) { address in
            guard
                let target = selectedTargets[address],
                let request = Self.request(url: target.url)
            else {
                throw URLError(.badURL)
            }
            let (data, response) = try await loader(request)
            guard
                let http = response as? HTTPURLResponse,
                http.statusCode == 200,
                let strings = ActivityCheckResponse.strings(
                    from: data,
                    confirmedPath: target.confirmedPath,
                    pendingPath: target.pendingPath
                )
            else {
                throw URLError(.badServerResponse)
            }
            return strings
        }

        var baseline = ActivityCheckWriteBack.baseline(config)
        let changed = ActivityCheckBudget.applyReads(baseline: &baseline, reads: reads)
        let nowMs = milliseconds(now())
        var stored = false
        if let updated = ActivityCheckWriteBack.updated(
            json,
            reads: reads,
            nowMs: nowMs
        ) {
            stored = (try? files.writeConfig(updated)) != nil
        }
        files.appendRun(atMs: nowMs)
        if changed, stored, let notice = ActivityNotice.args(
            title: config.noticeTitle,
            body: config.noticeBody
        ) {
            poster.post(notice)
        }
        return true
    }

    static func sessionConfiguration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        let timeout = TimeInterval(ActivityCheckRules.requestTimeoutSeconds)
        configuration.timeoutIntervalForRequest = timeout
        configuration.timeoutIntervalForResource = timeout
        return configuration
    }

    static func request(url: String) -> URLRequest? {
        guard
            let url = URL(string: url),
            ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
            !(url.host ?? "").isEmpty
        else {
            return nil
        }
        var request = URLRequest(
            url: url,
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: TimeInterval(ActivityCheckRules.requestTimeoutSeconds)
        )
        request.httpMethod = "GET"
        return request
    }

    private static func defaultCheck() -> BackgroundActivityCheck? {
        guard let support = try? FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        ) else {
            return nil
        }
        return BackgroundActivityCheck(
            directory: support.appendingPathComponent(
                "activity-check",
                isDirectory: true
            )
        )
    }

    private func milliseconds(_ date: Date) -> Int64 {
        Int64(date.timeIntervalSince1970 * 1_000)
    }
}
