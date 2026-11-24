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

package io.xchain.wallet.android.activity;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import io.xchain.wallet.android.notify.NotifyChannels;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

public final class BackgroundActivityWorker extends Worker {

    public static final long REPEAT_HOURS = 6;
    static final String FAMILY = "incomingReceipts";
    static final int NOTIFICATION_ID = 0x58434143;

    public BackgroundActivityWorker(
            @NonNull Context context,
            @NonNull WorkerParameters parameters) {
        super(context, parameters);
    }

    public static PeriodicWorkRequest periodicRequest() {
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();
        return new PeriodicWorkRequest.Builder(
                BackgroundActivityWorker.class, REPEAT_HOURS, TimeUnit.HOURS)
                .setConstraints(constraints)
                .build();
    }

    public static void enqueue(Context context) {
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                ActivityCheckStore.WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                periodicRequest());
    }

    @NonNull
    @Override
    public Result doWork() {
        try {
            runOnce(getApplicationContext(), null, System.currentTimeMillis());
            return Result.success();
        } catch (IOException error) {
            return Result.retry();
        }
    }

    static boolean runOnce(
            Context context,
            ActivityCheckBudget.AddressReader injectedReader,
            long nowMs) throws IOException {
        ActivityCheckFiles files = new ActivityCheckFiles(context.getFilesDir());
        String text = files.readConfig();
        if (text == null) return false;

        JSONObject config;
        try {
            config = new JSONObject(text);
        } catch (JSONException error) {
            return false;
        }
        if (!Boolean.TRUE.equals(config.opt("enabled"))) return false;

        JSONArray values = config.optJSONArray("targets");
        Map<String, Target> targets = new LinkedHashMap<>();
        Map<String, Long> lastCheckedAt = new LinkedHashMap<>();
        Map<String, List<String>> baseline = new LinkedHashMap<>();
        if (values != null) {
            for (int index = 0; index < values.length(); index++) {
                Target target = Target.from(values.optJSONObject(index));
                if (target == null || targets.containsKey(target.address)) continue;
                targets.put(target.address, target);
                if (target.lastCheckedAt != null) {
                    lastCheckedAt.put(target.address, target.lastCheckedAt);
                }
                if (target.confirmed != null && target.pending != null) {
                    List<String> strings = new ArrayList<>(2);
                    strings.add(target.confirmed);
                    strings.add(target.pending);
                    baseline.put(target.address, strings);
                }
            }
        }
        if (targets.isEmpty()) return false;

        List<String> picked = ActivityCheckBudget.pick(
                new ArrayList<>(targets.keySet()), lastCheckedAt, ActivityCheckBudget.MAX_ADDRESSES);
        ActivityCheckBudget.AddressReader reader = injectedReader != null
                ? injectedReader
                : address -> read(targets.get(address));
        Map<String, List<String>> reads = ActivityCheckBudget.run(picked, reader);
        boolean changed = ActivityCheckBudget.applyReads(baseline, reads);

        boolean configChanged = false;
        try {
            for (Map.Entry<String, List<String>> entry : reads.entrySet()) {
                Target target = targets.get(entry.getKey());
                List<String> strings = entry.getValue();
                if (strings != null) {
                    target.json.put("lastCheckedAt", nowMs);
                    target.json.put("confirmed", strings.get(0));
                    target.json.put("pending", strings.get(1));
                    configChanged = true;
                }
            }
        } catch (JSONException error) {
            throw new IOException("could not update activity check config", error);
        }
        if (configChanged) files.writeConfig(config.toString());
        files.appendRun(nowMs);
        if (changed) postNotice(context, config);
        return true;
    }

    private static List<String> read(Target target) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(target.url).openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(ActivityCheckBudget.REQUEST_TIMEOUT_MS);
            connection.setReadTimeout(ActivityCheckBudget.REQUEST_TIMEOUT_MS);
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) return null;
            try (InputStream input = connection.getInputStream();
                    BufferedReader reader = new BufferedReader(
                            new InputStreamReader(input, StandardCharsets.UTF_8))) {
                StringBuilder body = new StringBuilder();
                for (String line; (line = reader.readLine()) != null; ) body.append(line);
                Object tree = toTree(new JSONTokener(body.toString()).nextValue());
                return ActivityCheckResponse.strings(
                        tree, target.confirmedPath, target.pendingPath);
            }
        } catch (IOException | JSONException error) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static Object toTree(Object value) throws JSONException {
        if (value == JSONObject.NULL) return null;
        if (value instanceof JSONObject) {
            Map<String, Object> map = new LinkedHashMap<>();
            JSONObject object = (JSONObject) value;
            Iterator<String> keys = object.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                map.put(key, toTree(object.get(key)));
            }
            return map;
        }
        if (value instanceof JSONArray) {
            List<Object> list = new ArrayList<>();
            JSONArray array = (JSONArray) value;
            for (int index = 0; index < array.length(); index++) {
                list.add(toTree(array.get(index)));
            }
            return list;
        }
        return value;
    }

    private static void postNotice(Context context, JSONObject config) {
        JSONObject notice = config.optJSONObject("notice");
        String title = string(notice, "title");
        String body = string(notice, "body");
        String channelId = NotifyChannels.channelId(FAMILY);
        if (title == null || body == null || channelId == null) return;

        int icon = context.getApplicationInfo().icon;
        if (icon == 0) icon = android.R.drawable.stat_notify_sync_noanim;
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channelId)
                .setSmallIcon(icon)
                .setContentTitle(title)
                .setContentText(body)
                .setAutoCancel(true);
        Intent launch = context.getPackageManager()
                .getLaunchIntentForPackage(context.getPackageName());
        String openTitle = string(config, "openOnPhoneTitle");
        if (launch != null) {
            PendingIntent pending = PendingIntent.getActivity(
                    context,
                    NOTIFICATION_ID,
                    launch,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            builder.setContentIntent(pending);
            if (openTitle != null) builder.addAction(0, openTitle, pending);
        }
        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, builder.build());
        } catch (SecurityException ignored) {
        }
    }

    private static String string(JSONObject object, String key) {
        if (object == null) return null;
        Object value = object.opt(key);
        if (!(value instanceof String)) return null;
        String string = (String) value;
        return string.trim().isEmpty() ? null : string;
    }

    private static final class Target {
        final JSONObject json;
        final String address;
        final String url;
        final String confirmedPath;
        final String pendingPath;
        final String confirmed;
        final String pending;
        final Long lastCheckedAt;

        private Target(JSONObject json) {
            this.json = json;
            address = string(json, "address");
            url = string(json, "url");
            confirmedPath = string(json, "confirmedPath");
            pendingPath = string(json, "pendingPath");
            confirmed = nullableString(json.opt("confirmed"));
            pending = nullableString(json.opt("pending"));
            Object checkedAt = json.opt("lastCheckedAt");
            lastCheckedAt = checkedAt instanceof Number
                    ? ((Number) checkedAt).longValue()
                    : null;
        }

        static Target from(JSONObject json) {
            if (json == null) return null;
            Target target = new Target(json);
            return target.address == null || target.url == null
                    || target.confirmedPath == null || target.pendingPath == null
                    ? null
                    : target;
        }

        private static String nullableString(Object value) {
            return value instanceof String ? (String) value : null;
        }
    }
}
