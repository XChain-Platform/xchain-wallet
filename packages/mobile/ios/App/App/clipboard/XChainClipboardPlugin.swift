// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// `XChainClipboard`, the iOS half of SSC-4 (; contract in  §1.1,
// iOS mechanics in  §4).
//
// The contract is defined once, in the SPA, at
// packages/core/src/shared/clipboard.js. This file implements it; the Android
// twin implements the same two methods. Anything changed here and not there is
// a divergence between two shells that are supposed to be one wallet.
//
// WHAT THIS IS FOR. `UIPasteboard.general.string = seed` - which is what a
// WebView's `navigator.clipboard` does - hands the seed to Universal Clipboard,
// which is ON by default and copies it to every nearby device signed into the
// same Apple account, within seconds. Any foreground app can also read the
// pasteboard with no prompt and no user-visible sign. So a sensitive copy here
// is written with:
//
//   .localOnly      - never leaves this device. This is the Universal
//                     Clipboard opt-out, and it is the whole point.
//   .expirationDate - the system drops it at the deadline, whether or not this
//                     app is still running. A JS timer cannot promise that:
//                     it dies with the WebView, and the seed screen's
//                     60-second auto-clear was exactly that kind of promise.
//
// SSC-1 (bridge boundary) applies here as it does to the vault plugin: the
// entire surface JS can reach is a string and two scalars. No path, no URL, no
// class name, nothing that names anything on the device.

import Capacitor
import Foundation
import UIKit
// UTType is the modern replacement for the kUTType* constants, which are gone
// from the current SDK headers. iOS 14+, and the deployment target is 16 (D5).
import UniformTypeIdentifiers

@objc(XChainClipboardPlugin)
public class XChainClipboardPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "XChainClipboardPlugin"
    public let jsName = "XChainClipboard"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]

    /// Upper bound on a sensitive clip's life, in seconds.
    ///
    /// The JS side asks for 60. This clamps whatever it asks for, because a
    /// caller that passed a huge TTL - by bug or by a tampered bundle - would
    /// otherwise turn "expiring" into "permanent" for a seed phrase.
    private static let maxSensitiveTTL: TimeInterval = 300

    @objc func write(_ call: CAPPluginCall) {
        let value = call.getString("value") ?? ""
        let sensitive = call.getBool("sensitive") ?? false
        let requested = TimeInterval(call.getDouble("ttlSeconds") ?? 60)

        DispatchQueue.main.async {
            let board = UIPasteboard.general
            if sensitive {
                let ttl = min(max(requested, 1), Self.maxSensitiveTTL)
                // setItems with options, NOT `.string =`: the options are the
                // only way to say local-only and expiring, and assigning
                // `.string` afterwards would silently replace the item and
                // drop both.
                board.setItems(
                    [[UTType.utf8PlainText.identifier: value]],
                    options: [
                        .localOnly: true,
                        .expirationDate: Date().addingTimeInterval(ttl)
                    ]
                )
                // `marked` mirrors the Android twin's reply, which reports
                // whether the sensitivity mark was actually APPLIED (its
                // EXTRA_IS_SENSITIVE is Android 13+, so it can be false there).
                // iOS has had these pasteboard options since well before the
                // iOS 16 deployment target, so it is always true here - stated
                // rather than omitted, so the two shells answer the same shape.
                call.resolve([
                    "ok": true,
                    "sensitive": true,
                    "marked": true,
                    "ttlSeconds": ttl
                ])
            } else {
                // An address or a txid: public data the user may well want to
                // paste on their Mac. No reason to break Universal Clipboard
                // for it, and pretending otherwise would train users to work
                // around the app.
                board.string = value
                call.resolve(["ok": true, "sensitive": false])
            }
        }
    }

    @objc func clear(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            // Empty ITEMS, not an empty string: assigning "" leaves a pasteboard
            // item behind, and on a device with Universal Clipboard that empty
            // item is itself synced. `items = []` removes the contents.
            UIPasteboard.general.items = []
            call.resolve(["ok": true])
        }
    }
}

