/*
 * Copyright © 2025-2026 Dankest, LLC
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

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.WorkManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

@CapacitorPlugin(
        name = "XChainNotify",
        permissions = @Permission(
                alias = XChainNotifyPlugin.NOTIFICATION_PERMISSION,
                strings = Manifest.permission.POST_NOTIFICATIONS))
public class XChainNotifyPlugin extends Plugin {

    static final String NOTIFICATION_PERMISSION = "notifications";
    static final String ACTION_EVENT = "action";
    private static final String EXTRA_CONSUMED =
            "io.xchain.wallet.android.notify.ACTION_CONSUMED";
    @Override
    public void load() {
        createChannels(getContext());
        dispatchAction(getActivity() == null ? null : getActivity().getIntent());
    }

    @PluginMethod
    public void post(PluginCall call) {
        try {
            NotificationSpec spec = NotificationSpec.from(call, false);
            post(getContext(), spec);
            JSObject result = new JSObject();
            result.put("posted", true);
            call.resolve(result);
        } catch (RuntimeException error) {
            call.reject(error.getMessage(), error);
        }
    }

    @PluginMethod
    public void schedule(PluginCall call) {
        try {
            NotificationSpec spec = NotificationSpec.from(call, true);
            ScheduledNotify.schedule(
                    getContext(), spec.id, spec.at, spec.title, spec.body, spec.channelId());
            JSObject result = new JSObject();
            result.put("scheduled", true);
            call.resolve(result);
        } catch (RuntimeException error) {
            call.reject(error.getMessage(), error);
        }
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        try {
            String id = required(call.getString("id"), "id");
            NotificationManagerCompat.from(getContext()).cancel(id.hashCode());
            ScheduledNotify.cancel(getContext(), id);
            JSObject result = new JSObject();
            result.put("cancelled", true);
            call.resolve(result);
        } catch (RuntimeException error) {
            call.reject(error.getMessage(), error);
        }
    }

    @PluginMethod
    public void cancelAll(PluginCall call) {
        NotificationManagerCompat.from(getContext()).cancelAll();
        WorkManager.getInstance(getContext()).cancelAllWorkByTag(ScheduledNotify.TAG);
        call.resolve();
    }

    @PluginMethod
    public void permissionState(PluginCall call) {
        resolvePermission(call);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || getPermissionState(NOTIFICATION_PERMISSION) == PermissionState.GRANTED) {
            resolvePermission(call);
            return;
        }
        requestPermissionForAlias(
                NOTIFICATION_PERMISSION, call, "notificationPermissionCallback");
    }

    @PermissionCallback
    private void notificationPermissionCallback(PluginCall call) {
        resolvePermission(call);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        dispatchAction(intent);
    }

    static void createChannels(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) throw new IllegalStateException("Notification service unavailable");
        for (String family : NotifyChannels.FAMILIES) {
            manager.createNotificationChannel(new NotificationChannel(
                    NotifyChannels.channelId(family), family,
                    NotificationManager.IMPORTANCE_DEFAULT));
        }
    }

    static Notification post(Context context, NotificationSpec spec) {
        createChannels(context);
        Notification notification = build(context, spec);
        NotificationManagerCompat.from(context).notify(spec.id.hashCode(), notification);
        return notification;
    }

    static Notification build(Context context, NotificationSpec spec) {
        NotificationCompat.Builder builder = new NotificationCompat.Builder(
                context, spec.channelId())
                .setSmallIcon(context.getApplicationInfo().icon)
                .setContentTitle(spec.title)
                .setContentText(spec.body)
                .setAutoCancel(true)
                .setLocalOnly(false)
                .setCategory(spec.category)
                .setGroup(spec.threadId);
        if (spec.openOnPhone) {
            NotificationCompat.Action action = new NotifyActions(context)
                    .openOnPhone(spec.category, spec.id);
            if (action != null) {
                builder.addAction(action);
                builder.setContentIntent(action.actionIntent);
            }
        }
        return builder.build();
    }

    private void resolvePermission(PluginCall call) {
        PermissionState state = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                ? PermissionState.GRANTED
                : getPermissionState(NOTIFICATION_PERMISSION);
        JSObject result = new JSObject();
        result.put("state", state == null ? PermissionState.PROMPT.toString() : state.toString());
        call.resolve(result);
    }

    private void dispatchAction(Intent intent) {
        JSObject payload = actionPayload(intent);
        if (payload != null) notifyListeners(ACTION_EVENT, payload, true);
    }

    static JSObject actionPayload(Intent intent) {
        if (intent == null || intent.getBooleanExtra(EXTRA_CONSUMED, false)) return null;
        String action = intent.getStringExtra(NotifyActionRules.EXTRA_ACTION);
        String category = intent.getStringExtra(NotifyActionRules.EXTRA_CATEGORY);
        String id = intent.getStringExtra(NotifyActionRules.EXTRA_ID);
        if (!NotifyActionRules.isOpenOnPhone(action, category, id)) return null;
        intent.putExtra(EXTRA_CONSUMED, true);
        JSObject payload = new JSObject();
        payload.put("action", action);
        payload.put("category", category);
        payload.put("id", id);
        return payload;
    }

    private static String required(String value, String name) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(name + " is required");
        }
        return value;
    }

    static final class NotificationSpec {
        final String id;
        final String title;
        final String body;
        final String family;
        final String category;
        final String threadId;
        final boolean openOnPhone;
        final long at;

        NotificationSpec(String id, String title, String body, String family,
                String category, String threadId, boolean openOnPhone, long at) {
            this.id = required(id, "id");
            this.title = required(title, "title");
            this.body = body;
            if (!NotifyChannels.isFamily(family)) {
                throw new IllegalArgumentException("Unknown notification family");
            }
            this.family = family;
            this.category = category;
            this.threadId = threadId;
            this.openOnPhone = openOnPhone;
            this.at = at;
        }

        String channelId() {
            return NotifyChannels.channelId(family);
        }

        static NotificationSpec from(PluginCall call, boolean scheduled) {
            Long at = call.getLong("at");
            if (scheduled && at == null) throw new IllegalArgumentException("at is required");
            return new NotificationSpec(
                    call.getString("id"),
                    call.getString("title"),
                    call.getString("body"),
                    call.getString("family"),
                    call.getString("category", "alert"),
                    call.getString("threadId"),
                    hasOpenOnPhone(call.getArray("actions")),
                    at == null ? 0L : at);
        }

        private static boolean hasOpenOnPhone(JSArray actions) {
            if (actions == null) return false;
            for (int index = 0; index < actions.length(); index += 1) {
                JSONObject action = actions.optJSONObject(index);
                if (action != null && NotifyActionRules.ACTION_OPEN_ON_PHONE.equals(
                        action.optString("id", null))) return true;
            }
            return false;
        }
    }
}
