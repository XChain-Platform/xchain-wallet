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

package io.xchain.wallet.android.links;

import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Delivers App Links and {@code xchain:} links to the SPA ( §1, S3).
 *
 * WHY NOT {@code @capacitor/app}. That plugin would do the delivery, and it
 * would also hand every script in the WebView {@code exitApp()},
 * {@code minimizeApp()} and the app-state stream. The spec's rule is to
 * register only what is used (§1, the bridge boundary), and what is used
 * here is one event and one method.
 *
 * THE COLD-START RACE IS THE REASON FOR {@code takePendingLink}. A tap on a
 * link launches the app: the intent is delivered to the activity long before
 * the WebView has loaded the SPA, let alone before any JS listener exists.
 * An event-only design drops exactly the case that matters most - the link
 * that started the app - so the first link is queued here and the SPA
 * collects it when it is ready. Warm taps arrive through the event.
 *
 * NATIVE VALIDATION IS DEFENCE IN DEPTH, NOT THE GATE. Only the two shapes
 * the app claims in its manifest are forwarded; anything else is dropped
 * without reaching JS. The real invariants - never bypass the unlock screen,
 * never auto-advance into a signing or connect flow, re-display every
 * extracted parameter for confirmation - are enforced in the shared UI,
 * because that is where the user is. This class just refuses to be a second
 * way in.
 */
@CapacitorPlugin(name = "XChainLinks")
public class XChainLinksPlugin extends Plugin {

    private static final String EVENT = "xchainUrlOpen";
    private static final String SCHEME_APP = "xchain";
    private static final String SCHEME_WEB = "https";
    private static final String HOST_WEB = "xchain.io";

    /**
     * Marks an Intent this plugin has already taken the link out of.
     *
     * Capacitor hands the LAUNCH intent to both {@link #load()} and
     * {@link #handleOnNewIntent(Intent)} - the same Intent object, twice -
     * so without a marker one tap is extracted twice and the SPA applies it
     * twice. Measured on an API 36 emulator, 2026-08-01.
     */
    private static final String EXTRA_CONSUMED = "io.xchain.wallet.android.links.CONSUMED";

    /** The link that launched the app, until the SPA asks for it. */
    private String pending;

    @Override
    public void load() {
        Intent intent = getActivity() == null ? null : getActivity().getIntent();
        pending = extract(intent);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        String url = extract(intent);
        if (url == null) return;

        // QUEUE **XOR** NOTIFY, which is the whole delivery contract: one
        // intent reaches the SPA exactly once.
        //
        // Doing both, which is what this did until it was run, delivers the
        // same link twice. Emulator trace: the cold-start notify found no
        // listener and Capacitor RETAINED it; the SPA then read the queue
        // (delivery one) and attached its listener, at which point the
        // retained event fired (delivery two). Clearing the queue on read
        // cannot prevent that, because the replay arrives down the other
        // channel entirely - so the guarantee has to be that only one
        // channel is ever used per intent.
        //
        // The `false` matters as much as the branch: a retained event is a
        // deferred replay by definition, and deferring is exactly what the
        // queue is already for.
        if (hasListeners(EVENT)) {
            JSObject payload = new JSObject();
            payload.put("url", url);
            notifyListeners(EVENT, payload, false);
        } else {
            // No listener yet - a warm tap landing while the WebView reloads
            // after process death. The SPA collects this when it subscribes.
            pending = url;
        }
    }

    /**
     * Hand over the queued link, once. Returns {@code {url: null}} when
     * there is nothing waiting, which is the normal case for an app the user
     * opened from its icon.
     */
    @PluginMethod
    public void takePendingLink(PluginCall call) {
        JSObject reply = new JSObject();
        reply.put("url", pending);
        // Cleared on read so a later reload cannot replay a link the user
        // has already been shown, re-prefilling a send form they dismissed.
        pending = null;
        call.resolve(reply);
    }

    /**
     * The URL from an intent, if it is one of ours. Null for everything
     * else, including the plain launcher intent.
     */
    private String extract(Intent intent) {
        if (intent == null) return null;
        Uri data = intent.getData();
        if (data == null) return null;
        String scheme = data.getScheme();
        if (scheme == null) return null;
        // Already taken out of this Intent (see EXTRA_CONSUMED). Android
        // hands the launch intent to load() and to handleOnNewIntent, and
        // keeps handing the same object back from getIntent() for the life
        // of the activity, so "have I seen this one" has to live on the
        // Intent rather than in a field.
        if (intent.getBooleanExtra(EXTRA_CONSUMED, false)) return null;

        if (SCHEME_APP.equalsIgnoreCase(scheme)) {
            intent.putExtra(EXTRA_CONSUMED, true);
            return data.toString();
        }
        if (SCHEME_WEB.equalsIgnoreCase(scheme) && HOST_WEB.equalsIgnoreCase(data.getHost())) {
            intent.putExtra(EXTRA_CONSUMED, true);
            return data.toString();
        }
        // An http:// link, another host, or a scheme some other app aimed at
        // us. The manifest should not have routed it here at all; dropping it
        // silently is the right answer either way.
        return null;
    }
}
