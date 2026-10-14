/*
 * Copyright © 2025–2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC - https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

package io.xchain.wallet.android.splash;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import io.xchain.wallet.android.MainActivity;

/** Exposes only the readiness signal needed to release the native splash. */
@CapacitorPlugin(name = "SplashScreen")
public class XChainSplashPlugin extends Plugin {
    @PluginMethod
    public void hide(PluginCall call) {
        if (!(getActivity() instanceof MainActivity)) {
            call.reject("XChain splash host is unavailable");
            return;
        }
        ((MainActivity) getActivity()).markShellReady();
        call.resolve();
    }
}
