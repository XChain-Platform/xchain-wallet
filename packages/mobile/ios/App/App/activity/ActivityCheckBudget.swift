// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Dispatch
import Foundation

private actor ActivityCheckRead {
    private var result: [String]??
    private var continuation: CheckedContinuation<[String]?, Never>?

    func resolve(_ value: [String]?) {
        guard result == nil else { return }
        result = value
        continuation?.resume(returning: value)
        continuation = nil
    }

    func value() async -> [String]? {
        if let result { return result }
        return await withCheckedContinuation { continuation = $0 }
    }
}

enum ActivityCheckBudget {
    typealias Reader = @Sendable (String) async throws -> [String]

    static func run(
        _ addresses: [String],
        lastCheckedAt: [String: Int64],
        reader: @escaping Reader
    ) async -> [String: [String]?] {
        await run(
            addresses,
            lastCheckedAt: lastCheckedAt,
            parallel: ActivityCheckRules.parallel,
            requestTimeoutNanoseconds: UInt64(ActivityCheckRules.requestTimeoutSeconds) * 1_000_000_000,
            runBudgetNanoseconds: UInt64(ActivityCheckRules.runBudgetSeconds) * 1_000_000_000,
            reader: reader
        )
    }

    static func run(
        _ addresses: [String],
        lastCheckedAt: [String: Int64],
        parallel: Int,
        requestTimeoutNanoseconds: UInt64,
        runBudgetNanoseconds: UInt64,
        reader: @escaping Reader
    ) async -> [String: [String]?] {
        let selected = ActivityCheckRules.pick(
            addresses,
            lastCheckedAt: lastCheckedAt,
            max: ActivityCheckRules.maxAddresses
        )
        guard parallel > 0, !selected.isEmpty, runBudgetNanoseconds > 0 else { return [:] }

        let deadline = DispatchTime.now().uptimeNanoseconds + runBudgetNanoseconds
        var reads: [String: [String]?] = [:]
        await withTaskGroup(of: (String, [String]?).self) { group in
            var next = 0
            while next < min(parallel, selected.count) {
                let now = DispatchTime.now().uptimeNanoseconds
                guard now < deadline else { break }
                let address = selected[next]
                next += 1
                let remaining = deadline - now
                group.addTask {
                    (address, await read(address, timeout: min(requestTimeoutNanoseconds, remaining), reader: reader))
                }
            }

            while let (address, value) = await group.next() {
                reads.updateValue(value, forKey: address)
                let now = DispatchTime.now().uptimeNanoseconds
                guard next < selected.count, now < deadline else { continue }
                let nextAddress = selected[next]
                next += 1
                group.addTask {
                    (nextAddress, await read(nextAddress, timeout: min(requestTimeoutNanoseconds, deadline - now), reader: reader))
                }
            }
        }
        return reads
    }

    static func applyReads(
        baseline: inout [String: [String]],
        reads: [String: [String]?]
    ) -> Bool {
        ActivityCheckRules.applyReads(baseline: &baseline, reads: reads)
    }

    private static func read(
        _ address: String,
        timeout: UInt64,
        reader: @escaping Reader
    ) async -> [String]? {
        let read = ActivityCheckRead()
        let readerTask = Task {
            await read.resolve(try? await reader(address))
        }
        let timeoutTask = Task {
            try? await Task.sleep(nanoseconds: timeout)
            guard !Task.isCancelled else { return }
            await read.resolve(nil)
        }
        let value = await read.value()
        readerTask.cancel()
        timeoutTask.cancel()
        return value
    }
}
