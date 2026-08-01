// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The one reason this subclass exists: registering the vault plugin.
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

import Capacitor
import UIKit

class MainViewController: CAPBridgeViewController {

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(XChainVaultPlugin())
    }
}
