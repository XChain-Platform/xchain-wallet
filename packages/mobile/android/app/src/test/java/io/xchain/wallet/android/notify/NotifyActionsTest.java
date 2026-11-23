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

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.robolectric.Shadows.shadowOf;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

import androidx.core.app.NotificationCompat;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.shadows.ShadowPendingIntent;

import io.xchain.wallet.android.MainActivity;
import io.xchain.wallet.android.notify.NotifyActionRules;
import io.xchain.wallet.android.notify.NotifyActions;

@RunWith(RobolectricTestRunner.class)
public class NotifyActionsTest {

    private ActivityCheckFiles files;
    private NotifyActions actions;

    @Before
    public void setUp() {
        Context context = RuntimeEnvironment.getApplication();
        files = new ActivityCheckFiles(context.getFilesDir());
        files.clear();
        actions = new NotifyActions(context);
    }

    @After
    public void tearDown() {
        files.clear();
    }

    @Test
    public void leavesActionOffUntilConfigIsStoredAndAfterClear() throws Exception {
        assertNull(actions.openOnPhone("request", "request-1"));

        files.writeConfig("{\"openOnPhoneTitle\":\"Open on phone\"}");
        assertEquals("Open on phone", actions.openOnPhone("request", "request-1").title);
        assertEquals("Open on phone", actions.openOnPhone("paydue", "payment-1").title);

        assertTrue(files.clear());
        assertNull(actions.openOnPhone("request", "request-1"));
    }

    @Test
    public void buildsMainActivityPendingIntentWithRoutingExtras() throws Exception {
        files.writeConfig("{\"openOnPhoneTitle\":\" Open request \",\"enabled\":true}");

        NotificationCompat.Action action = actions.openOnPhone("request", "request-7");
        assertEquals("Open request", action.title);

        PendingIntent pending = action.actionIntent;
        ShadowPendingIntent shadow = shadowOf(pending);
        assertTrue(shadow.isActivity());
        assertTrue(shadow.isImmutable());
        Intent intent = shadow.getSavedIntent();
        assertEquals(MainActivity.class.getName(), intent.getComponent().getClassName());
        assertEquals(NotifyActionRules.ACTION_OPEN_ON_PHONE,
                intent.getStringExtra(NotifyActionRules.EXTRA_ACTION));
        assertEquals("request", intent.getStringExtra(NotifyActionRules.EXTRA_CATEGORY));
        assertEquals("request-7", intent.getStringExtra(NotifyActionRules.EXTRA_ID));
    }

    @Test
    public void leavesActionOffForInvalidConfigCategoryOrId() throws Exception {
        files.writeConfig("{\"openOnPhoneTitle\":\"Open on phone\"}");

        assertNull(actions.openOnPhone("alert", "alert-1"));
        assertNull(actions.openOnPhone("request", null));
        assertNull(actions.openOnPhone("request", ""));

        files.writeConfig("not-json");
        assertNull(actions.openOnPhone("request", "request-1"));
    }
}
