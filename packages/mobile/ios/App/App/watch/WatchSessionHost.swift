// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import Foundation
import UIKit
import WatchConnectivity

protocol PhoneWatchSession: AnyObject {
    var delegate: WCSessionDelegate? { get set }
    var activationState: WCSessionActivationState { get }
    var isPaired: Bool { get }
    var isWatchAppInstalled: Bool { get }
    var isReachable: Bool { get }

    func activate()
}

extension WCSession: PhoneWatchSession {}

struct WatchSessionState: Equatable {
    let paired: Bool
    let installed: Bool
    let reachable: Bool
}

final class WatchSessionHost: NSObject, WCSessionDelegate {
    static let shared = WatchSessionHost(
        session: WCSession.isSupported() ? WCSession.default : nil
    )

    let session: PhoneWatchSession?
    private(set) var state: WatchSessionState
    var onIntent: ((String, [String: Any]) -> Void)?

    var supported: Bool { session != nil }
    var activationState: WCSessionActivationState { session?.activationState ?? .notActivated }

    @discardableResult
    static func activateAtLaunch(session: PhoneWatchSession? = nil) -> WatchSessionHost {
        session.map { WatchSessionHost(session: $0) } ?? shared
    }

    init(session: PhoneWatchSession?) {
        self.session = session
        self.state = Self.readState(from: session)
        super.init()
        session?.delegate = self
        session?.activate()
    }

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        refreshState()
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        self.session?.activate()
    }

    func sessionWatchStateDidChange(_ session: WCSession) {
        refreshState()
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        refreshState()
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        guard let intent = WatchIntentMessage.read(message) else { return }
        onIntent?(intent.kind, intent.value)
    }

    private func refreshState() {
        state = Self.readState(from: session)
    }

    private static func readState(from session: PhoneWatchSession?) -> WatchSessionState {
        WatchSessionState(
            paired: session?.isPaired == true,
            installed: session?.isWatchAppInstalled == true,
            reachable: session?.isReachable == true
        )
    }
}
