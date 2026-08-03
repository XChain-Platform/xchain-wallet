// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// `XChainLinks`, the iOS half of deep-link intake ( §3; contract and
// Android twin in  §1, stage S3).
//
// The contract is defined once, in the SPA, at
// packages/web/src/deeplinks/nativeDeepLinks.js: one method, `takePendingLink`,
// and one event, `xchainUrlOpen`. The Android twin
// (links/XChainLinksPlugin.java) implements the same two. Anything changed here
// and not there is a divergence between two shells that are supposed to be one
// wallet.
//
// WHY THIS FILE EXISTS AT ALL, given the native side "looked wired". Universal
// Links were claimed by the association file, and `SceneDelegate` forwarded the
// `NSUserActivity` to Capacitor's proxy, so iOS opened the app on a tap. That
// is three layers out of four: the proxy's delivery target is `@capacitor/app`'s
// `appUrlOpen`, that package is not a dependency, and nothing in the SPA listens
// for it. The link was claimed, forwarded, and then dropped on the floor - the
// app came to the foreground on its default view with the payload discarded, and
// a green build could never say otherwise. §2.1 counts Universal Links as one of
// the six native integrations answering guideline 4.2, so a reviewer tapping a
// link and watching nothing happen is watching that defence fail.
//
// WHY NOT `@capacitor/app`, which would do the delivery. Same answer as Android:
// it would also hand every script in the WebView `exitApp()`, `minimizeApp()`
// and the app-state stream. The rule is to register only what is used (§1, the
// bridge boundary), and what is used here is one event and one method.
//
// NATIVE VALIDATION IS DEFENCE IN DEPTH, NOT THE GATE. Only the two shapes the
// app claims are forwarded; anything else is dropped without reaching JS. The
// real invariants - never bypass the unlock screen, never auto-advance into a
// signing or connect flow, re-display every extracted parameter for
// confirmation - are enforced in the shared UI, because that is where the user
// is. This file just refuses to be a second way in.

import Capacitor
import Foundation

/// Carries a link from `SceneDelegate` to the plugin.
///
/// THE COLD-START LINK IS WHY THIS IS A SEPARATE OBJECT, and iOS loses it in a
/// different way than Android does. On Android the same `Intent` is handed to
/// the plugin twice and the trap is delivering it twice; here the launching link
/// is handed through a DOOR THE PLUGIN CANNOT SEE. A tap that starts the app
/// delivers its `NSUserActivity` in `scene(_:willConnectTo:options:)`'s
/// `connectionOptions` and never calls `scene(_:continue:)` at all, so a shell
/// that implements only the warm callbacks drops exactly the tap that matters
/// most - the one that opened the app.
///
/// That method is also where `MainViewController` is constructed, which is where
/// the plugin instance comes into existence, so "is the plugin alive yet" is a
/// race this code would have to win on ordering it does not control. A
/// file-static inbox removes the question: the link is deliverable before any
/// bridge exists, and it waits.
final class XChainLinkInbox {

    static let shared = XChainLinkInbox()

    /// The event name the SPA subscribes to. Matches `LINKS_PLUGIN`'s listener
    /// in nativeDeepLinks.js and Android's `EVENT`.
    static let event = "xchainUrlOpen"

    private static let schemeApp = "xchain"
    private static let schemeWeb = "https"
    private static let hostWeb = "xchain.io"

    /// Delivery can arrive on the main thread (the scene callbacks) while the
    /// plugin drains on the bridge's queue, so the one field they share is
    /// locked rather than assumed.
    private let lock = NSLock()

    /// The link that launched the app, until the SPA asks for it.
    private var pending: String?

    /// Weak: the plugin's lifetime belongs to the bridge, and an inbox that
    /// outlived it must not be what keeps it alive.
    private weak var plugin: CAPPlugin?

    private init() {}

    /// Called from the plugin's `load()`.
    func attach(_ plugin: CAPPlugin) {
        lock.lock()
        self.plugin = plugin
        lock.unlock()
    }

    /// Accept one inbound link, from any of the four scene doors.
    ///
    /// QUEUE **XOR** NOTIFY, which is the whole delivery contract: one link
    /// reaches the SPA exactly once. Android learned this on an emulator - a
    /// cold-start notify with no listener was RETAINED by Capacitor and replayed
    /// the moment the SPA subscribed, on top of the queued copy it had just
    /// read, so the same send form was prefilled twice. Capacitor's iOS bridge
    /// has the same retain-until-consumed machinery, so the same rule applies:
    /// only one channel is ever used per link, and `retainUntilConsumed: false`
    /// says the event channel never defers. Deferring is what the queue is for.
    func deliver(_ raw: String?) {
        guard let url = Self.accept(raw) else { return }

        lock.lock()
        let target = plugin
        lock.unlock()

        if let target = target, target.hasListeners(Self.event) {
            target.notifyListeners(Self.event, data: ["url": url], retainUntilConsumed: false)
            return
        }

        // No listener yet: a cold start, or a warm tap landing while the WebView
        // reloads. The SPA collects this when it subscribes.
        lock.lock()
        pending = url
        lock.unlock()
    }

    /// Hand over the queued link, once.
    ///
    /// Cleared on read so a later reload cannot replay a link the user has
    /// already been shown, re-prefilling a send form they dismissed.
    func take() -> String? {
        lock.lock()
        defer { lock.unlock() }
        let url = pending
        pending = nil
        return url
    }

    /// The URL, if it is one of ours. Nil for everything else.
    ///
    /// Mirrors `isAcceptableDeepLink` in nativeDeepLinks.js, including the
    /// 4096-character bound and the reason it parses instead of prefix-matching:
    /// `https://xchain.io.evil.com/` and `https://xchain.io@evil.com/` both pass
    /// a naive `hasPrefix`, and `URLComponents` puts the host where it belongs.
    /// The JS half checks this too; that is the half that still runs if this
    /// plugin is ever replaced, and this is the half that keeps a hostile link
    /// out of the WebView entirely.
    static func accept(_ raw: String?) -> String? {
        guard let raw = raw, !raw.isEmpty, raw.count <= 4096,
              let parsed = URLComponents(string: raw),
              let scheme = parsed.scheme?.lowercased() else { return nil }

        if scheme == Self.schemeApp { return raw }
        if scheme == Self.schemeWeb, parsed.host?.lowercased() == Self.hostWeb { return raw }

        // An http:// link, another host, or a scheme some other app aimed at us.
        // The association file and the URL types should not have routed it here
        // at all; dropping it silently is the right answer either way.
        return nil
    }
}

@objc(XChainLinksPlugin)
public class XChainLinksPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "XChainLinksPlugin"
    public let jsName = "XChainLinks"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "takePendingLink", returnType: CAPPluginReturnPromise)
    ]

    override public func load() {
        XChainLinkInbox.shared.attach(self)
    }

    /// Hand over the queued link, once. Resolves with no `url` key when there is
    /// nothing waiting, which is the normal case for an app the user opened from
    /// its icon. Android answers `{url: null}`; the SPA reads `reply?.url` and
    /// treats both the same, and Swift cannot put a nil into a `[String: Any]`
    /// without dressing it up as `NSNull`, which would be a third shape.
    @objc func takePendingLink(_ call: CAPPluginCall) {
        if let url = XChainLinkInbox.shared.take() {
            call.resolve(["url": url])
        } else {
            call.resolve([:])
        }
    }
}
