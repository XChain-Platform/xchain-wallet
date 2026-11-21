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
import static org.junit.Assert.assertThrows;

import org.junit.Test;

public class ScheduledNotifyNamesTest {

    @Test
    public void exposesSchedulingNames() {
        assertEquals("xc_scheduled_notify", ScheduledNotify.TAG);
        assertEquals("xc_notify_at_", ScheduledNotify.WORK_NAME_PREFIX);
    }

    @Test
    public void buildsAUniqueNameForADeadlineId() {
        assertEquals(
                "xc_notify_at_deadline:invoice-42",
                ScheduledNotify.uniqueWorkName("deadline:invoice-42"));
    }

    @Test
    public void rejectsNullAndEmptyIds() {
        assertThrows(IllegalArgumentException.class, () -> ScheduledNotify.uniqueWorkName(null));
        assertThrows(IllegalArgumentException.class, () -> ScheduledNotify.uniqueWorkName(""));
    }

    @Test
    public void calculatesNonNegativeInitialDelay() {
        long nowMs = 1_800_000_000_000L;

        assertEquals(3_600_000L, ScheduledNotify.initialDelayMillis(nowMs + 3_600_000L, nowMs));
        assertEquals(0L, ScheduledNotify.initialDelayMillis(nowMs, nowMs));
        assertEquals(0L, ScheduledNotify.initialDelayMillis(nowMs - 60_000L, nowMs));
    }
}
