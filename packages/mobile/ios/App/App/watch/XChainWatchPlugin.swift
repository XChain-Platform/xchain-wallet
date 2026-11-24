// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Capacitor
import WatchConnectivity

@objc(XChainWatchPlugin)
public class XChainWatchPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "XChainWatchPlugin"
    public let jsName = "XChainWatch"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
    ]

    var host = WatchSessionHost.shared
    var lastSyncAt: Int64?

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
}
