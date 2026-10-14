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
import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** App capabilities that need an Android activity. */
@CapacitorPlugin(name = "App")
public class XChainAppPlugin extends Plugin {
    private static final String BACK_BUTTON = "backButton";
    private static final String FONT_SCALE_CHANGED = "fontScaleChanged";

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

    /** Keep WebView zoom fixed while exposing the user's system text preference. */
    public void dispatchFontScale(float fontScale) {
        JSObject payload = new JSObject();
        payload.put("fontScale", fontScale);
        notifyListeners(FONT_SCALE_CHANGED, payload, true);
    }

    /** Return the current scale when the web listener attaches after startup. */
    @PluginMethod
    public void getFontScale(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity is available.");
            return;
        }
        JSObject payload = new JSObject();
        payload.put("fontScale", activity.getResources().getConfiguration().fontScale);
        call.resolve(payload);
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

    /** Open Android's chooser with the public payment request. */
    @PluginMethod
    public void share(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity is available.");
            return;
        }

        String title = call.getString("title", "");
        String text = call.getString("text", "");
        String url = call.getString("url", "");
        String body = text.isEmpty() || url.isEmpty()
            ? text + url
            : text + "\n" + url;
        if (body.isEmpty()) {
            call.reject("Nothing is available to share.");
            return;
        }

        try {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_TEXT, body);
            if (!title.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, title);
            activity.startActivity(Intent.createChooser(send, title.isEmpty() ? null : title));
            JSObject result = new JSObject();
            result.put("completed", true);
            call.resolve(result);
        } catch (RuntimeException error) {
            call.reject("The share sheet is unavailable.", error);
        }
    }
}
