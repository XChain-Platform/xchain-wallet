// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// SSC-1 : Capacitor's own general-purpose plugins, neutered.
//
// MEASURED ON AN iPhone 17 Pro Max SIMULATOR, 2026-08-01, from ordinary page
// script, exactly as the Android twin was measured:
//
//     Capacitor.Plugins.CapacitorHttp.request({url: 'https://example.com/',
//                                              method: 'GET'})
//     -> status 200, 559 bytes of somebody else's HTML
//
// and `CapacitorCookies.getCookies` answered the same way. Those requests are
// made by the NATIVE stack, so the WebView's Content-Security-Policy does not
// constrain them - not its `connect-src`, not any future tightening of it.
//
// SSC-1's rule is "register ONLY the plugins actually used", because any
// script in the webview can call every registered plugin, and this wallet
// renders chain-derived attacker-controlled strings, so an SPA XSS is a
// credible path. This app uses neither plugin: it fetches through the
// WebView's own `fetch`, which the CSP does govern.
//
// WHY SHADOWING RATHER THAN REMOVAL. Capacitor registers these in
// `CapacitorBridge.registerPlugins()`, which is unconditional, and there is no
// un-register API. `bridge.plugins` is module-internal on iOS, so the Android
// twin's reflection trick does not port. What IS public is
// `registerPluginInstance`, which overwrites `plugins[jsName]` - so
// registering these stubs under the same `jsName` displaces the real plugins
// out of the map the bridge dispatches from.
//
// Shadowing turns out to be SAFER than removal here. `handleJSCall` resolves a
// plugin as `plugins[call.pluginId] ?? load()`, where `load()` is
// `NSClassFromString(call.pluginId)` - so a merely-removed entry could be
// resurrected by class lookup. It cannot resurrect these, because the
// Objective-C names are `CAPHttpPlugin`/`CAPCookiesPlugin` while the lookup
// key is the jsName, but that is an accident of naming and not a guarantee.
// An occupied slot needs no such argument.
//
// The methods mirror the real plugins' names ON PURPOSE. A stub with no
// methods would make `handleJSCall` log "No method found" and return, leaving
// the JS promise pending forever; a caller cannot tell that from a slow
// network. These reject, loudly and immediately. If a future Capacitor adds a
// method this list lacks, that call hangs rather than resolving - undesirable,
// but not a hole: the real plugin is still out of the map either way.
//
// The config switch that looks like the answer is not: `CapacitorHttp.enabled`
// only decides whether the JS layer patches `fetch`/`XHR` (verified on the
// simulator: `fetch` is still native, so it is already off) and has nothing to
// say about whether the plugin method can be called.
//
// NOT SUFFICIENT ON ITS OWN. See `MainViewController.blockNativeHttpProxy()`:
// there is a second native path that does not go through the plugin registry
// at all.

import Capacitor
import Foundation

/// Rejection shared by both stubs, so the message a caller sees names the
/// control rather than looking like a transient failure.
private func refuse(_ call: CAPPluginCall, _ plugin: String) {
    call.reject("SSC-1: \(plugin) is not available in XChain Wallet.")
}

@objc(XChainDisabledHttpPlugin)
public class XChainDisabledHttpPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "XChainDisabledHttpPlugin"
    // Deliberately the REAL plugin's jsName: occupying this key is the control.
    public let jsName = "CapacitorHttp"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "post", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "put", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "patch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "delete", returnType: CAPPluginReturnPromise)
    ]

    @objc func request(_ call: CAPPluginCall) { refuse(call, "CapacitorHttp") }
    @objc func get(_ call: CAPPluginCall) { refuse(call, "CapacitorHttp") }
    @objc func post(_ call: CAPPluginCall) { refuse(call, "CapacitorHttp") }
    @objc func put(_ call: CAPPluginCall) { refuse(call, "CapacitorHttp") }
    @objc func patch(_ call: CAPPluginCall) { refuse(call, "CapacitorHttp") }
    @objc func delete(_ call: CAPPluginCall) { refuse(call, "CapacitorHttp") }
}

@objc(XChainDisabledCookiesPlugin)
public class XChainDisabledCookiesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "XChainDisabledCookiesPlugin"
    public let jsName = "CapacitorCookies"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getCookies", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setCookie", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteCookie", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearCookies", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearAllCookies", returnType: CAPPluginReturnPromise)
    ]

    @objc func getCookies(_ call: CAPPluginCall) { refuse(call, "CapacitorCookies") }
    @objc func setCookie(_ call: CAPPluginCall) { refuse(call, "CapacitorCookies") }
    @objc func deleteCookie(_ call: CAPPluginCall) { refuse(call, "CapacitorCookies") }
    @objc func clearCookies(_ call: CAPPluginCall) { refuse(call, "CapacitorCookies") }
    @objc func clearAllCookies(_ call: CAPPluginCall) { refuse(call, "CapacitorCookies") }
}
