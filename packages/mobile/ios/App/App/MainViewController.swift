// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The one reason this subclass exists: registering this app's own plugins.
//
// Capacitor 8 does NOT discover iOS plugins by scanning the runtime. It
// registers what `capacitor.config.json`'s packageClassList names, and that
// list is generated from installed plugin PACKAGES - an app-local plugin like
// ours never appears in it. So without the call below, `XChainVault` simply
// does not exist at run time.
//
// AND THAT FAILURE IS SILENT, which is why it gets a subclass of its own
// rather than a line buried somewhere. `nativeVault.js` returns null when the
// plugin is absent, and `backends.js` then hands the app an
// IndexedDBStorageBackend: the wallet works, looks correct, and stores the
// only copy of the vault in WebView storage, which is the evictable place
// this entire stage exists to move it out of. Nothing logs. Nothing fails.
// `test/smoke/shells/mobile-ios-shell.smoke.js` asserts this file registers
// the plugin, because a green build proves nothing about it.
//
// It also carries the SSC-1 bridge hardening, which has TWO halves
// because the native HTTP surface turned out to have two doors.

import Capacitor
import UIKit
import WebKit

class MainViewController: CAPBridgeViewController {

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(XChainVaultPlugin())
        // SSC-4. Same silent-failure shape as the vault: without
        // this line the SPA finds no clipboard plugin, and a sensitive copy
        // then REFUSES rather than leaking to Universal Clipboard - visible,
        // but only as a copy button that stops working.
        bridge?.registerPluginInstance(XChainClipboardPlugin())
        // Deep links (§3). Third instance of the same silent shape: with
        // this line missing, `linksPlugin()` in nativeDeepLinks.js finds nothing
        // and `subscribeToNativeDeepLinks` returns a no-op, so a tapped
        // Universal Link opens the app on its default view and the payload is
        // discarded. Nothing logs, nothing fails, and the §2.1 guideline-4.2
        // defence demos as broken.
        bridge?.registerPluginInstance(XChainLinksPlugin())

        disableUnusedCapacitorPlugins()
        blockNativeHttpProxy()
    }

    // MARK: - SSC-1, door 1: the plugin registry

    /// Displace Capacitor's general-purpose plugins out of the bridge's
    /// dispatch map. The rationale, and the on-device measurement that
    /// motivated it, are in `DisabledCapacitorPlugins.swift`.
    ///
    /// `SystemBars`, `WebView` and `Console` stay registered: Capacitor's own
    /// runtime uses them and none is a general-purpose capability.
    ///
    /// The failure is LOUD on purpose, matching the Android twin. A security
    /// control that silently stops applying after a dependency bump is worse
    /// than one that was never there, because the spec still claims it.
    private func disableUnusedCapacitorPlugins() {
        guard let bridge = bridge else {
            fatalError("SSC-1: no bridge in capacitorDidLoad; cannot disable CapacitorHttp/CapacitorCookies.")
        }

        let stubs: [CAPPlugin] = [
            XChainDisabledHttpPlugin(),
            XChainDisabledCookiesPlugin()
        ]
        let names = ["CapacitorHttp", "CapacitorCookies"]
        for stub in stubs {
            bridge.registerPluginInstance(stub)
        }

        // Assert through the SAME lookup the bridge dispatches with. Winning
        // the registration race is the whole control, and registering into the
        // wrong map would look exactly like success.
        for (name, stub) in zip(names, stubs) {
            let resolved = bridge.plugin(withName: name)
            guard let resolved = resolved, resolved === stub else {
                fatalError("""
                    SSC-1: \(name) did not end up shadowed - the bridge still \
                    resolves it to \(String(describing: resolved)). A Capacitor \
                    upgrade has changed plugin registration; re-do this rather \
                    than shipping the native HTTP surface.
                    """)
            }
        }
    }

    // MARK: - SSC-1, door 2: the scheme-handler proxy

    /// Block Capacitor's native HTTP proxy, which does NOT go through the
    /// plugin registry and therefore survives everything above.
    ///
    /// MEASURED ON THE SAME SIMULATOR, 2026-08-01, from ordinary page script:
    ///
    ///     await (await fetch('/_capacitor_http_interceptor_?u='
    ///            + encodeURIComponent('https://example.com/'))).text()
    ///     -> status 200, 559 bytes, containing "Example Domain"
    ///
    /// `WebViewAssetHandler.webView(_:start:)` checks that path prefix before
    /// it consults the router, pulls the target out of the `u` query
    /// parameter, and fetches it with `URLSession.shared`.
    ///
    /// THIS ONE IS A REAL CSP BYPASS, not merely a surface the CSP does not
    /// reach. The URL the page requests is `capacitor://localhost/...`, which
    /// is SAME-ORIGIN, so `connect-src 'self'` permits it, and no tightening
    /// short of dropping `'self'` could refuse it - which the SPA needs. The
    /// cross-origin request then happens natively, after the CSP said yes.
    ///
    /// WHY A CONTENT RULE LIST. The handler is built inside
    /// `CAPBridgeViewController.loadView()`, which is `public final`, and
    /// `prepareWebView` is private, so the hardened-subclass route is closed:
    /// there is nowhere to inject one. A JS-layer patch is not a control here
    /// either - `frame-src 'self'` lets an attacker open a same-origin iframe
    /// and take a fresh, unpatched `fetch` out of its realm. A WebKit content
    /// rule list sits in the loader, below every JS realm, and is public API
    /// that survives Capacitor upgrades.
    private func blockNativeHttpProxy() {
        // Both identifiers, including the one Capacitor deprecated: the
        // deprecated path is still routed, and a rule covering only the
        // current name would silently stop covering an alias.
        let rules = """
        [{
          "trigger": { "url-filter": "_capacitor_http[s]?_interceptor_" },
          "action": { "type": "block" }
        }]
        """

        guard let store = WKContentRuleListStore.default() else {
            fatalError("SSC-1: no WKContentRuleListStore; cannot block the native HTTP proxy.")
        }

        store.compileContentRuleList(
            forIdentifier: "xchain-ssc1-no-native-http-proxy",
            encodedContentRuleList: rules
        ) { [weak self] list, error in
            if let error = error {
                fatalError("SSC-1: the native-HTTP-proxy block failed to compile: \(error)")
            }
            guard let list = list else {
                fatalError("SSC-1: the native-HTTP-proxy block compiled to nothing.")
            }
            guard let controller = self?.webView?.configuration.userContentController else {
                fatalError("SSC-1: no userContentController to install the native-HTTP-proxy block into.")
            }
            controller.add(list)
        }
    }
}
