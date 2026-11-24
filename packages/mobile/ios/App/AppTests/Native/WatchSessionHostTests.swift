// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import UIKit
import WatchConnectivity
import XCTest
@testable import App

final class WatchSessionHostTests: XCTestCase {
    func testApplicationLaunchStartsTheSharedSessionOwner() {
        let delegate = AppDelegateStub()

        let accepted = delegate.application(
            UIApplication.shared,
            willFinishLaunchingWithOptions: nil
        )

        XCTAssertTrue(accepted)
        XCTAssertEqual(delegate.activationCount, 1)
    }

    func testInitializationOwnsActivatesAndReadsTheSession() {
        let session = SessionStub(
            activationState: .activated,
            paired: true,
            installed: true,
            reachable: true
        )

        let host = WatchSessionHost(session: session)

        XCTAssertTrue(session.delegate === host)
        XCTAssertEqual(session.activationCount, 1)
        XCTAssertTrue(host.supported)
        XCTAssertEqual(host.activationState, .activated)
        XCTAssertEqual(
            host.state,
            WatchSessionState(paired: true, installed: true, reachable: true)
        )
    }

    func testInactiveDoesNotActivateAndDeactivatedReactivates() {
        let session = SessionStub()
        let host = WatchSessionHost(session: session)

        host.sessionDidBecomeInactive(.default)
        XCTAssertEqual(session.activationCount, 1)

        host.sessionDidDeactivate(.default)
        XCTAssertEqual(session.activationCount, 2)
    }

    func testWatchStateCallbackRefreshesPairedAndInstalledState() {
        let session = SessionStub()
        let host = WatchSessionHost(session: session)
        session.paired = true
        session.installed = true

        host.sessionWatchStateDidChange(.default)

        XCTAssertEqual(
            host.state,
            WatchSessionState(paired: true, installed: true, reachable: false)
        )
    }

    func testReachabilityCallbackRefreshesReachableState() {
        let session = SessionStub(paired: true, installed: true)
        let host = WatchSessionHost(session: session)
        session.reachable = true

        host.sessionReachabilityDidChange(.default)

        XCTAssertTrue(host.state.reachable)
    }

    func testUnsupportedHostReportsNoSessionState() {
        let host = WatchSessionHost(session: nil)

        XCTAssertFalse(host.supported)
        XCTAssertEqual(host.activationState, .notActivated)
        XCTAssertEqual(
            host.state,
            WatchSessionState(paired: false, installed: false, reachable: false)
        )
    }
}

private final class AppDelegateStub: AppDelegate {
    private(set) var activationCount = 0

    override func activateWatchSessionAtLaunch() {
        activationCount += 1
    }
}

private final class SessionStub: PhoneWatchSession {
    weak var delegate: WCSessionDelegate?
    var activationState: WCSessionActivationState
    var paired: Bool
    var installed: Bool
    var reachable: Bool
    private(set) var activationCount = 0

    var isPaired: Bool { paired }
    var isWatchAppInstalled: Bool { installed }
    var isReachable: Bool { reachable }

    init(
        activationState: WCSessionActivationState = .notActivated,
        paired: Bool = false,
        installed: Bool = false,
        reachable: Bool = false
    ) {
        self.activationState = activationState
        self.paired = paired
        self.installed = installed
        self.reachable = reachable
    }

    func activate() {
        activationCount += 1
    }
}
