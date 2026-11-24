// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import WatchConnectivity
import XCTest
@testable import App

final class WatchSessionHostTests: XCTestCase {
    func testActivateAtLaunchActivatesInjectedSessionExactlyOnce() {
        let session = SessionStub()

        let host = WatchSessionHost.activateAtLaunch(session: session)

        XCTAssertTrue(session.delegate === host)
        XCTAssertEqual(session.activationCount, 1)
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

    func testListedIntentMessageReachesHandler() {
        let host = WatchSessionHost(session: SessionStub())
        var received: [(kind: String, value: [String: Any])] = []
        host.onIntent = { received.append((kind: $0, value: $1)) }

        host.session(
            .default,
            didReceiveMessage: [
                "kind": "detailRequest",
                "value": ["tokenId": "bitcoin-mainnet:T01"],
            ]
        )

        XCTAssertEqual(received.count, 1)
        XCTAssertEqual(received.first?.kind, "detailRequest")
        XCTAssertEqual(received.first?.value["tokenId"] as? String, "bitcoin-mainnet:T01")
    }

    func testRefreshIntentMessageWithEmptyValueReachesHandler() {
        let host = WatchSessionHost(session: SessionStub())
        var received: [(kind: String, value: [String: Any])] = []
        host.onIntent = { received.append((kind: $0, value: $1)) }

        host.session(
            .default,
            didReceiveMessage: ["kind": "refresh", "value": [String: Any]()]
        )

        XCTAssertEqual(received.count, 1)
        XCTAssertEqual(received.first?.kind, "refresh")
        XCTAssertTrue(received.first?.value.isEmpty == true)
    }

    func testIntentMessageWithThirdKeyDoesNotReachHandler() {
        assertIntentMessageIsDropped(
            ["kind": "refresh", "value": [String: Any](), "extra": true]
        )
    }

    func testIntentMessageWithUnlistedKindDoesNotReachHandler() {
        assertIntentMessageIsDropped(
            ["kind": "unknown", "value": [String: Any]()]
        )
    }

    func testIntentMessageWithStringValueDoesNotReachHandler() {
        assertIntentMessageIsDropped(
            ["kind": "refresh", "value": "invalid"]
        )
    }

    func testListedIntentMessageWithoutHandlerReturns() {
        let host = WatchSessionHost(session: SessionStub())

        host.session(
            .default,
            didReceiveMessage: ["kind": "refresh", "value": [String: Any]()]
        )
    }

    private func assertIntentMessageIsDropped(_ message: [String: Any]) {
        let host = WatchSessionHost(session: SessionStub())
        var receivedCount = 0
        host.onIntent = { _, _ in receivedCount += 1 }

        host.session(.default, didReceiveMessage: message)

        XCTAssertEqual(receivedCount, 0)
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
