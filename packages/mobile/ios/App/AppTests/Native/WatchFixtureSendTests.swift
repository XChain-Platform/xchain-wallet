// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation
import WatchConnectivity
import XCTest
@testable import App

final class WatchFixtureSendTests: XCTestCase {
    func testSendsRiskEightPayloadThroughReachablePairedWatch() throws {
        guard WCSession.isSupported() else {
            throw XCTSkip("Watch connectivity is unavailable")
        }

        let session = WCSession.default
        session.activate()
        let deadline = Date().addingTimeInterval(5)
        while Date() < deadline,
              !(session.activationState == .activated
                && session.isPaired
                && session.isWatchAppInstalled
                && session.isReachable) {
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        guard session.activationState == .activated,
              session.isPaired,
              session.isWatchAppInstalled,
              session.isReachable else {
            throw XCTSkip("No paired watch is reachable")
        }

        let snapshot = WatchRisk8Payload.snapshotJSON(builtAt: 1_800_000_000_000)
        let context = try XCTUnwrap(
            JSONSerialization.jsonObject(with: snapshot) as? [String: Any]
        )
        let image = try XCTUnwrap(WatchRisk8Payload.image(side: 400))
        let sender = WatchSessionSend(session: session)

        try sender.sendSnapshot(context)
        XCTAssertTrue(try sender.sendImage(image.png))
    }
}
