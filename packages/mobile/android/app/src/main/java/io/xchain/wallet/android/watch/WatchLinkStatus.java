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

package io.xchain.wallet.android.watch;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

public final class WatchLinkStatus {

    private WatchLinkStatus() {}

    public static Map<String, Object> status(
            boolean available,
            boolean paired,
            boolean installed,
            boolean reachable,
            Long lastSyncAt) {
        boolean effectivePaired = available && paired;
        boolean effectiveInstalled = effectivePaired && installed;
        boolean effectiveReachable = effectiveInstalled && reachable;

        Map<String, Object> status = new LinkedHashMap<>();
        status.put("paired", effectivePaired);
        status.put("installed", effectiveInstalled);
        status.put("reachable", effectiveReachable);
        if (lastSyncAt != null && lastSyncAt >= 0) {
            status.put("lastSyncAt", lastSyncAt);
        }
        return Collections.unmodifiableMap(status);
    }
}
