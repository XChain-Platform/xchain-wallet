// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Dispatch
import XCTest
@testable import App

private actor ActivityCheckProbe {
    private var active = 0
    private var peak = 0
    private var addresses: [String] = []

    func started(_ address: String) {
        active += 1
        peak = max(peak, active)
        addresses.append(address)
    }

    func finished() {
        active -= 1
    }

    func snapshot() -> (Int, [String]) {
        (peak, addresses)
    }
}

final class ActivityCheckBudgetTests: XCTestCase {
    private enum ReadError: Error {
        case failed
    }

    func testUsesDesignBudgets() {
        XCTAssertEqual(ActivityCheckRules.maxAddresses, 20)
        XCTAssertEqual(ActivityCheckRules.parallel, 4)
        XCTAssertEqual(ActivityCheckRules.requestTimeoutSeconds, 10)
        XCTAssertEqual(ActivityCheckRules.runBudgetSeconds, 25)
    }

    func testPicksAtMostTwentyOldestAddresses() async {
        let addresses = (0..<25).map { "address-\($0)" }.reversed()
        let timestamps = Dictionary(uniqueKeysWithValues: (0..<25).map {
            ("address-\($0)", Int64($0))
        })
        let probe = ActivityCheckProbe()

        let reads = await ActivityCheckBudget.run(
            Array(addresses),
            lastCheckedAt: timestamps,
            parallel: 1,
            requestTimeoutNanoseconds: 1_000_000_000,
            runBudgetNanoseconds: 2_000_000_000
        ) { address in
            await probe.started(address)
            await probe.finished()
            return [address, "pending"]
        }
        let (_, called) = await probe.snapshot()

        XCTAssertEqual(reads.count, 20)
        XCTAssertEqual(called, (0..<20).map { "address-\($0)" })
    }

    func testRunsFourReadsAtOnce() async {
        let probe = ActivityCheckProbe()
        let addresses = (0..<12).map { "address-\($0)" }

        let reads = await ActivityCheckBudget.run(addresses, lastCheckedAt: [:]) { address in
            await probe.started(address)
            try await Task.sleep(nanoseconds: 20_000_000)
            await probe.finished()
            return [address, "pending"]
        }
        let (peak, called) = await probe.snapshot()

        XCTAssertEqual(peak, 4)
        XCTAssertEqual(called.count, 12)
        XCTAssertEqual(reads.count, 12)
    }

    func testTimeoutAndThrownReadBecomeFailures() async {
        let reads = await ActivityCheckBudget.run(
            ["ok", "throws", "slow"],
            lastCheckedAt: [:],
            parallel: 3,
            requestTimeoutNanoseconds: 30_000_000,
            runBudgetNanoseconds: 500_000_000
        ) { address in
            if address == "throws" { throw ReadError.failed }
            if address == "slow" { try await Task.sleep(nanoseconds: 1_000_000_000) }
            return [address, "pending"]
        }

        XCTAssertEqual(reads["ok"]!, ["ok", "pending"])
        XCTAssertTrue(reads.keys.contains("throws"))
        XCTAssertNil(reads["throws"]!)
        XCTAssertTrue(reads.keys.contains("slow"))
        XCTAssertNil(reads["slow"]!)
    }

    func testRunBudgetStopsLaterReads() async {
        let reads = await ActivityCheckBudget.run(
            ["first", "second"],
            lastCheckedAt: [:],
            parallel: 1,
            requestTimeoutNanoseconds: 1_000_000_000,
            runBudgetNanoseconds: 30_000_000
        ) { address in
            try await Task.sleep(nanoseconds: 1_000_000_000)
            return [address, "pending"]
        }

        XCTAssertEqual(Set(reads.keys), ["first"])
        XCTAssertNil(reads["first"]!)
    }

    func testTimeoutDoesNotWaitForReaderCancellation() async {
        let started = DispatchTime.now().uptimeNanoseconds
        let reads = await ActivityCheckBudget.run(
            ["stuck"],
            lastCheckedAt: [:],
            parallel: 1,
            requestTimeoutNanoseconds: 20_000_000,
            runBudgetNanoseconds: 500_000_000
        ) { address in
            await withCheckedContinuation { continuation in
                DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(300)) {
                    continuation.resume()
                }
            }
            return [address, "pending"]
        }
        let elapsed = DispatchTime.now().uptimeNanoseconds - started

        XCTAssertLessThan(elapsed, 200_000_000)
        XCTAssertTrue(reads.keys.contains("stuck"))
        XCTAssertNil(reads["stuck"]!)
    }

    func testFirstSightBaselinesAndFailedReadKeepsStrings() {
        var baseline = ["known": ["confirmed", "pending"]]
        let reads: [String: [String]?] = [
            "first": ["1", "0"],
            "known": nil,
        ]

        XCTAssertFalse(ActivityCheckBudget.applyReads(baseline: &baseline, reads: reads))
        XCTAssertEqual(baseline["first"], ["1", "0"])
        XCTAssertEqual(baseline["known"], ["confirmed", "pending"])
    }
}
