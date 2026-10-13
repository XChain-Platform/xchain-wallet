/*
 * Copyright © 2025–2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC - https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available -
 * contact legal@dankest.llc.
 */

package io.xchain.wallet.android.app;

import android.app.Activity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** The two App-plugin capabilities required by Android hardware Back. */
@CapacitorPlugin(name = "App")
public class XChainAppPlugin extends Plugin {
    private static final String BACK_BUTTON = "backButton";

    /**
     * Give the SPA first refusal on Back.
     *
     * @return true when a JavaScript listener owns this press
     */
    public boolean dispatchBackButton(boolean canGoBack) {
        if (!hasListeners(BACK_BUTTON)) return false;
        JSObject payload = new JSObject();
        payload.put("canGoBack", canGoBack);
        notifyListeners(BACK_BUTTON, payload, false);
        return true;
    }

    /** Put the task in the background without destroying its current flow. */
    @PluginMethod
    public void minimizeApp(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity is available.");
            return;
        }
        activity.moveTaskToBack(true);
        call.resolve();
    }
}
