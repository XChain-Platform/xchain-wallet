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

package io.xchain.wallet.android.activity;

import androidx.work.WorkManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;

@CapacitorPlugin(name = "XChainActivity")
public class XChainActivityPlugin extends Plugin {

    private ActivityCheckStore store;

    @Override
    public void load() {
        store = new ActivityCheckStore(
                getContext().getFilesDir(),
                () -> WorkManager.getInstance(getContext())
                        .cancelUniqueWork(ActivityCheckStore.WORK_NAME));
    }

    @PluginMethod
    public void setActivityCheck(PluginCall call) {
        String json = call.getString("json");
        if (json == null) {
            call.reject("json is required");
            return;
        }
        try {
            store.setActivityCheck(json);
            call.resolve();
        } catch (IOException error) {
            call.reject("could not store activity check", error);
        }
    }

    @PluginMethod
    public void runLog(PluginCall call) {
        try {
            JSArray runs = new JSArray();
            for (Long atMs : store.runLog()) runs.put(atMs);
            JSObject reply = new JSObject();
            reply.put("runs", runs);
            call.resolve(reply);
        } catch (IOException error) {
            call.reject("could not read activity check log", error);
        }
    }

    @PluginMethod
    public void clear(PluginCall call) {
        JSObject reply = new JSObject();
        reply.put("cleared", store.clear());
        call.resolve(reply);
    }
}
