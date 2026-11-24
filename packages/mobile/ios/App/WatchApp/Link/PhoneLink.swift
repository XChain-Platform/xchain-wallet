// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation
import WatchConnectivity

protocol PhoneSession: AnyObject {
    var isReachable: Bool { get }
    func setDelegate(_ delegate: WCSessionDelegate)
    func activate()
    func send(_ message: [String: Any])
}

extension WCSession: PhoneSession {
    func setDelegate(_ delegate: WCSessionDelegate) {
        self.delegate = delegate
    }

    func send(_ message: [String: Any]) {
        sendMessage(message, replyHandler: nil, errorHandler: nil)
    }
}

final class PhoneLink: NSObject, WCSessionDelegate {
    typealias SnapshotSink = (Data) -> Void
    typealias DetailSink = (Detail) -> Void
    typealias ImageSink = (Data, String) throws -> Void

    private let session: PhoneSession
    private let appVersion: String
    private let saveSnapshot: SnapshotSink
    private let saveDetail: DetailSink
    private let saveImage: ImageSink

    private(set) var isReachable = false

    init(
        session: PhoneSession = WCSession.default,
        appVersion: String = Bundle.main.object(
            forInfoDictionaryKey: "CFBundleShortVersionString"
        ) as? String ?? "",
        saveSnapshot: @escaping SnapshotSink,
        saveDetail: @escaping DetailSink,
        saveImage: @escaping ImageSink
    ) {
        self.session = session
        self.appVersion = appVersion
        self.saveSnapshot = saveSnapshot
        self.saveDetail = saveDetail
        self.saveImage = saveImage
        super.init()
        session.setDelegate(self)
    }

    func activate() {
        session.activate()
    }

    func refresh() { send("refresh", RefreshIntent()) }
    func detailRequest(_ tokenId: String) { send("detailRequest", DetailRequestIntent(tokenId: tokenId)) }
    func markRead(_ id: String) { send("markRead", MarkReadIntent(id: id)) }
    func openOnPhone(_ route: String) { send("openOnPhone", OpenOnPhoneIntent(route: route)) }

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        isReachable = self.session.isReachable
        guard activationState == .activated, error == nil else { return }
        send("watchState", WatchStateIntent(appVersion: appVersion))
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        isReachable = self.session.isReachable
    }

    func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) {
        receiveSnapshot(context)
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        if decodeDetail(message) == nil {
            receiveSnapshot(message)
        }
    }

    func session(_ session: WCSession, didReceive file: WCSessionFile) {
        receiveFile(at: file.fileURL, metadata: file.metadata)
    }

    func receiveFile(at url: URL, metadata: [String: Any]?) {
        guard let destination = PhoneFileMetadata.read(metadata),
              let data = try? Data(contentsOf: url) else { return }
        switch destination.kind {
        case .detail:
            guard let detail = try? JSONDecoder().decode(Detail.self, from: data),
                  detail.tokenId == destination.key else { return }
            saveDetail(detail)
        case .image:
            try? saveImage(data, destination.key)
        }
    }

    private func receiveSnapshot(_ object: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object, options: .sortedKeys) else { return }
        saveSnapshot(data)
    }

    @discardableResult
    private func decodeDetail(_ object: [String: Any]) -> Detail? {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object),
              let detail = try? JSONDecoder().decode(Detail.self, from: data) else { return nil }
        saveDetail(detail)
        return detail
    }

    private func send<T: Encodable>(_ kind: String, _ value: T) {
        guard let message = PhoneIntentMessage.message(kind: kind, value: value) else { return }
        session.send(message)
    }
}
