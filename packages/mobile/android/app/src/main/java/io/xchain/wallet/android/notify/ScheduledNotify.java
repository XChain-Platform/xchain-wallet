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

import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;

import androidx.core.app.NotificationCompat;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.concurrent.TimeUnit;

public final class ScheduledNotify {

    public static final String TAG = "xc_scheduled_notify";
    public static final String WORK_NAME_PREFIX = "xc_notify_at_";
    private static final String KEY_ID = "id";
    private static final String KEY_TITLE = "title";
    private static final String KEY_BODY = "body";
    private static final String KEY_CHANNEL = "channel";

    private ScheduledNotify() {}

    public static String uniqueWorkName(String id) {
        if (id == null || id.isEmpty()) {
            throw new IllegalArgumentException("id must not be null or empty");
        }
        return WORK_NAME_PREFIX + id;
    }

    public static long initialDelayMillis(long atMs, long nowMs) {
        long delay = atMs - nowMs;
        return delay > 0 ? delay : 0;
    }

    public static void schedule(
            Context context, String id, long atMs, String title, String body, String channelId) {
        Data input = new Data.Builder()
                .putString(KEY_ID, id)
                .putString(KEY_TITLE, title)
                .putString(KEY_BODY, body)
                .putString(KEY_CHANNEL, channelId)
                .build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(NotifyWorker.class)
                .setInputData(input)
                .setInitialDelay(
                        initialDelayMillis(atMs, System.currentTimeMillis()),
                        TimeUnit.MILLISECONDS)
                .addTag(TAG)
                .build();
        WorkManager.getInstance(context).enqueueUniqueWork(
                uniqueWorkName(id), ExistingWorkPolicy.REPLACE, request);
    }

    public static void cancel(Context context, String id) {
        WorkManager.getInstance(context).cancelUniqueWork(uniqueWorkName(id));
    }

    public static final class NotifyWorker extends Worker {
        public NotifyWorker(Context context, WorkerParameters parameters) {
            super(context, parameters);
        }

        @Override
        public Result doWork() {
            Data input = getInputData();
            String id = input.getString(KEY_ID);
            String title = input.getString(KEY_TITLE);
            String channelId = input.getString(KEY_CHANNEL);
            if (id == null || title == null || channelId == null) {
                return Result.failure();
            }
            Notification notification = new NotificationCompat.Builder(
                    getApplicationContext(), channelId)
                    .setSmallIcon(getApplicationContext().getApplicationInfo().icon)
                    .setContentTitle(title)
                    .setContentText(input.getString(KEY_BODY))
                    .setAutoCancel(true)
                    .build();
            NotificationManager manager = getApplicationContext()
                    .getSystemService(NotificationManager.class);
            if (manager == null) {
                return Result.failure();
            }
            manager.notify(id.hashCode(), notification);
            return Result.success();
        }
    }
}
