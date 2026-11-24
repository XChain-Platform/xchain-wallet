// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import Capacitor

@objc(XChainActivityPlugin)
public class XChainActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "XChainActivityPlugin"
    public let jsName = "XChainActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setActivityCheck", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "runLog", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
    ]

    var store: ActivityCheckStore?

    @objc func setActivityCheck(_ call: CAPPluginCall) {
        let options: [String: Any] = ["json": call.getString("json") ?? ""]
        guard let json = ActivityPluginReplies.configJson(options) else {
            call.reject("json is required")
            return
        }
        do {
            try activityStore().setActivityCheck(json)
            call.resolve()
        } catch {
            call.reject("could not store activity check", nil, error)
        }
    }

    @objc func runLog(_ call: CAPPluginCall) {
        do {
            call.resolve(ActivityPluginReplies.runLog(try activityStore().runLog()))
        } catch {
            call.reject("could not read activity check log", nil, error)
        }
    }

    @objc func clear(_ call: CAPPluginCall) {
        do {
            call.resolve(ActivityPluginReplies.cleared(try activityStore().clear()))
        } catch {
            call.reject("could not clear activity check", nil, error)
        }
    }

    private func activityStore() throws -> ActivityCheckStore {
        if let store { return store }
        let created = try ActivityCheckStore()
        store = created
        return created
    }
}
