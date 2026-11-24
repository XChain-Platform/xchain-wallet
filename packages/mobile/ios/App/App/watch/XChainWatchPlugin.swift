// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Capacitor
import ObjectiveC
import WatchConnectivity

private var watchIntentHandlerKey: UInt8 = 0

extension WatchSessionHost {
    var onIntent: ((String, [String: Any]) -> Void)? {
        get {
            objc_getAssociatedObject(self, &watchIntentHandlerKey)
                as? (String, [String: Any]) -> Void
        }
        set {
            objc_setAssociatedObject(
                self,
                &watchIntentHandlerKey,
                newValue,
                .OBJC_ASSOCIATION_COPY_NONATOMIC
            )
        }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        guard let intent = WatchIntentMessage.read(message) else { return }
        onIntent?(intent.kind, intent.value)
    }
}

@objc(XChainWatchPlugin)
public class XChainWatchPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "XChainWatchPlugin"
    public let jsName = "XChainWatch"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendDetail", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendImage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeWatchData", returnType: CAPPluginReturnPromise),
    ]

    var host = WatchSessionHost.shared
    lazy var sender = WatchSessionSend()
    var lastSyncAt: Int64?
    var intentPublisher: ((String, [String: Any]) -> Void)?

    override public func load() {
        host.onIntent = { [weak self] kind, value in
            self?.publishIntent(kind: kind, value: value)
        }
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": host.supported])
    }

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(WatchLinkStatus.dictionary(
            supported: host.supported,
            activated: host.activationState == .activated,
            paired: host.state.paired,
            installed: host.state.installed,
            reachable: host.state.reachable,
            lastSyncAt: lastSyncAt
        ))
    }

    @objc func sendSnapshot(_ call: CAPPluginCall) {
        guard let context = WatchPluginArgs.snapshotContext(json: call.getString("json")),
              let builtAt = context["builtAt"] as? NSNumber,
              CFGetTypeID(builtAt) != CFBooleanGetTypeID() else {
            return call.reject("valid snapshot json is required")
        }
        if settle(call, operation: { try sender.sendSnapshot(context) }) {
            lastSyncAt = builtAt.int64Value
        }
    }

    @objc func sendDetail(_ call: CAPPluginCall) {
        guard let detail = WatchPluginArgs.detailFile(json: call.getString("json")) else {
            return call.reject("valid detail json is required")
        }
        settle(call) { _ = try sender.sendDetail(detail.data, tokenId: detail.tokenId) }
    }

    @objc func sendImage(_ call: CAPPluginCall) {
        guard let image = WatchImageArgs.decode(
            hash: call.getString("hash"),
            base64: call.getString("base64")
        ) else {
            return call.reject("valid image hash and base64 are required")
        }
        settle(call) { _ = try sender.sendImage(image) }
    }

    @objc func removeWatchData(_ call: CAPPluginCall) {
        let builtAt = Int64(Date().timeIntervalSince1970 * 1_000)
        if settle(call, operation: {
            try sender.sendSnapshot(Self.disabledSnapshot(builtAt: builtAt))
        }) {
            lastSyncAt = nil
        }
    }

    func publishIntent(kind: String, value: [String: Any]) {
        if let intentPublisher {
            intentPublisher(kind, value)
            return
        }
        notifyListeners(
            "intent",
            data: ["kind": kind, "value": value],
            retainUntilConsumed: false
        )
    }

    @discardableResult
    private func settle(_ call: CAPPluginCall, operation: () throws -> Void) -> Bool {
        do {
            try operation()
            call.resolve()
            return true
        } catch {
            call.reject("watch transfer failed", nil, error)
            return false
        }
    }

    private static func disabledSnapshot(builtAt: Int64) -> [String: Any] {
        [
            "v": 1, "builtAt": builtAt, "balancesAt": builtAt, "pricesAt": builtAt,
            "session": "unlocked", "network": ["kind": "mainnet", "isTest": false],
            "fiatCode": "USD", "hidden": false, "unitDefault": "fiat", "walletName": "",
            "totals": ["fiatText": "", "unitsText": "Balances"], "rows": [],
            "capped": false, "receive": [], "inbox": [],
            "settings": ["showTotal": false, "enabled": false],
        ]
    }
}
