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

public final class ScheduledNotify {

    public static final String TAG = "xc_scheduled_notify";
    public static final String WORK_NAME_PREFIX = "xc_notify_at_";

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
}
