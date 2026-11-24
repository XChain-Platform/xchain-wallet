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

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;

import android.content.Context;

import androidx.work.Configuration;
import androidx.work.WorkInfo;
import androidx.work.WorkManager;
import androidx.work.testing.SynchronousExecutor;
import androidx.work.testing.WorkManagerTestInitHelper;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

import java.util.List;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class BackgroundActivityEnqueueTest {

    @Test
    public void enqueueKeepsPendingWorkAndRestartsAfterCancellation() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        Configuration configuration = new Configuration.Builder()
                .setExecutor(new SynchronousExecutor())
                .build();
        WorkManagerTestInitHelper.initializeTestWorkManager(context, configuration);
        WorkManager workManager = WorkManager.getInstance(context);

        BackgroundActivityWorker.enqueue(context);
        List<WorkInfo> firstWork = workManager.getWorkInfosForUniqueWork(
                "xc_activity_check").get();
        assertEquals(1, firstWork.size());
        WorkInfo first = firstWork.get(0);
        assertEquals(WorkInfo.State.ENQUEUED, first.getState());

        BackgroundActivityWorker.enqueue(context);
        List<WorkInfo> secondWork = workManager.getWorkInfosForUniqueWork(
                "xc_activity_check").get();
        assertEquals(1, secondWork.size());
        assertEquals(first.getId(), secondWork.get(0).getId());
        assertEquals(WorkInfo.State.ENQUEUED, secondWork.get(0).getState());

        workManager.cancelUniqueWork("xc_activity_check").getResult().get();
        BackgroundActivityWorker.enqueue(context);
        List<WorkInfo> enqueued = workManager.getWorkInfosForUniqueWork(
                "xc_activity_check").get().stream()
                .filter(info -> info.getState() == WorkInfo.State.ENQUEUED)
                .toList();
        assertEquals(1, enqueued.size());
        assertNotEquals(first.getId(), enqueued.get(0).getId());
    }
}
