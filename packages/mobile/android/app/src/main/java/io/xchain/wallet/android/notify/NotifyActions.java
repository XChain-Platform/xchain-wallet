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

package io.xchain.wallet.android.notify;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

import androidx.core.app.NotificationCompat;

import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import io.xchain.wallet.android.MainActivity;

public final class NotifyActions {

    private static final String CONFIG_FILE = "activity-check.json";

    private final Context context;

    public NotifyActions(Context context) {
        this.context = context;
    }

    public NotificationCompat.Action openOnPhone(String category, String id) {
        String title = NotifyActionRules.openOnPhoneTitle(category, storedTitle());
        if (title == null || id == null || id.isEmpty()) return null;

        Intent intent = new Intent(context, MainActivity.class)
                .putExtra(NotifyActionRules.EXTRA_ACTION, NotifyActionRules.ACTION_OPEN_ON_PHONE)
                .putExtra(NotifyActionRules.EXTRA_CATEGORY, category)
                .putExtra(NotifyActionRules.EXTRA_ID, id);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pending = PendingIntent.getActivity(context, id.hashCode(), intent, flags);
        return new NotificationCompat.Action.Builder(0, title, pending).build();
    }

    private String storedTitle() {
        try {
            File file = new File(context.getFilesDir(), CONFIG_FILE);
            if (!file.isFile()) return null;
            String text = new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
            Object title = new JSONObject(text).opt("openOnPhoneTitle");
            return title instanceof String ? (String) title : null;
        } catch (Exception ignored) {
            return null;
        }
    }
}
