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

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.util.List;

final class ActivityCheckStore {

    static final String WORK_NAME = "xc_activity_check";

    private final ActivityCheckFiles files;
    private final Runnable cancelPeriodicWork;

    ActivityCheckStore(File appFiles, Runnable cancelPeriodicWork) {
        files = new ActivityCheckFiles(appFiles);
        this.cancelPeriodicWork = cancelPeriodicWork;
    }

    void setActivityCheck(String json) throws IOException {
        try {
            JSONObject input = new JSONObject(json);
            JSONObject config = new JSONObject();
            config.put("enabled", required(input, "enabled", Boolean.class));

            JSONArray targets = required(input, "targets", JSONArray.class);
            JSONArray publicTargets = new JSONArray();
            for (int index = 0; index < targets.length(); index++) {
                JSONObject target = targets.getJSONObject(index);
                JSONObject publicTarget = new JSONObject();
                copyString(target, publicTarget, "address", true);
                copyString(target, publicTarget, "url", true);
                copyString(target, publicTarget, "confirmedPath", true);
                copyString(target, publicTarget, "pendingPath", true);
                copyString(target, publicTarget, "confirmed", false);
                copyString(target, publicTarget, "pending", false);
                publicTargets.put(publicTarget);
            }
            config.put("targets", publicTargets);

            JSONObject inputNotice = required(input, "notice", JSONObject.class);
            JSONObject notice = new JSONObject();
            copyString(inputNotice, notice, "title", true);
            copyString(inputNotice, notice, "body", true);
            config.put("notice", notice);
            copyString(input, config, "openOnPhoneTitle", true);
            files.writeConfig(config.toString());
        } catch (JSONException error) {
            throw new IOException("invalid activity check config", error);
        }
    }

    private static <T> T required(JSONObject object, String key, Class<T> type)
            throws JSONException {
        Object value = object.get(key);
        if (!type.isInstance(value)) throw new JSONException("invalid " + key);
        return type.cast(value);
    }

    private static void copyString(
            JSONObject source, JSONObject destination, String key, boolean required)
            throws JSONException {
        if (!source.has(key) && !required) return;
        destination.put(key, required(source, key, String.class));
    }

    List<Long> runLog() throws IOException {
        return files.runLog();
    }

    boolean clear() {
        cancelPeriodicWork.run();
        return files.clear();
    }
}
