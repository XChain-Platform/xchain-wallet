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

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.robolectric.Shadows.shadowOf;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;

import androidx.work.Configuration;
import androidx.work.WorkInfo;
import androidx.work.WorkManager;
import androidx.work.testing.SynchronousExecutor;
import androidx.work.testing.TestDriver;
import androidx.work.testing.WorkManagerTestInitHelper;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowNotificationManager;

import java.util.List;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class ScheduledNotifyTest {

    @Test
    public void schedulesPostsReplacesAndCancelsUniqueWork() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        Configuration configuration = new Configuration.Builder()
                .setExecutor(new SynchronousExecutor())
                .build();
        WorkManagerTestInitHelper.initializeTestWorkManager(context, configuration);
        WorkManager workManager = WorkManager.getInstance(context);
        NotificationManager notificationManager = context.getSystemService(NotificationManager.class);
        assertNotNull(notificationManager);
        notificationManager.createNotificationChannel(new NotificationChannel(
                "xc_notify_deadlines", "Deadlines", NotificationManager.IMPORTANCE_DEFAULT));

        long inOneMinute = System.currentTimeMillis() + 60_000L;
        ScheduledNotify.schedule(context, "deadline-1", inOneMinute,
                "Deadline", "One hour left.", "xc_notify_deadlines");
        WorkInfo first = only(workManager, "deadline-1");
        assertEquals(WorkInfo.State.ENQUEUED, first.getState());
        assertTrue(first.getTags().contains(ScheduledNotify.TAG));

        TestDriver driver = WorkManagerTestInitHelper.getTestDriver(context);
        assertNotNull(driver);
        driver.setInitialDelayMet(first.getId());
        assertEquals(WorkInfo.State.SUCCEEDED,
                workManager.getWorkInfoById(first.getId()).get().getState());
        ShadowNotificationManager shadowManager = shadowOf(notificationManager);
        Notification posted = shadowManager.getNotification("deadline-1".hashCode());
        assertNotNull(posted);
        assertEquals("Deadline", posted.extras.getString(Notification.EXTRA_TITLE));
        assertEquals("One hour left.", posted.extras.getString(Notification.EXTRA_TEXT));

        ScheduledNotify.schedule(context, "deadline-2", inOneMinute,
                "Old", "Old body", "xc_notify_deadlines");
        WorkInfo replaced = only(workManager, "deadline-2");
        ScheduledNotify.schedule(context, "deadline-2", inOneMinute,
                "New", "New body", "xc_notify_deadlines");
        assertCancelledOrPruned(workManager, replaced);
        WorkInfo replacement = enqueued(workManager, "deadline-2");
        assertTrue(!replacement.getId().equals(replaced.getId()));

        ScheduledNotify.cancel(context, "deadline-2");
        assertCancelledOrPruned(workManager, replacement);
    }

    private static WorkInfo only(WorkManager manager, String id) throws Exception {
        List<WorkInfo> work = manager.getWorkInfosForUniqueWork(
                ScheduledNotify.uniqueWorkName(id)).get();
        assertEquals(1, work.size());
        return work.get(0);
    }

    private static WorkInfo enqueued(WorkManager manager, String id) throws Exception {
        return manager.getWorkInfosForUniqueWork(ScheduledNotify.uniqueWorkName(id)).get().stream()
                .filter(info -> info.getState() == WorkInfo.State.ENQUEUED)
                .findFirst()
                .orElseThrow(AssertionError::new);
    }

    private static void assertCancelledOrPruned(WorkManager manager, WorkInfo work)
            throws Exception {
        WorkInfo current = manager.getWorkInfoById(work.getId()).get();
        assertTrue(current == null || current.getState() == WorkInfo.State.CANCELLED);
    }
}
