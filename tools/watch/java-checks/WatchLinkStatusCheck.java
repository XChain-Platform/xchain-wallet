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

import io.xchain.wallet.android.watch.WatchLinkStatus;

import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

public final class WatchLinkStatusCheck {

    private static void fail(String name, String detail) {
        System.err.println("FAIL: " + name + " " + detail);
        System.exit(1);
    }

    private static void expectBoolean(
            String name, Map<String, Object> status, String key, boolean expected) {
        Object actual = status.get(key);
        if (!(actual instanceof Boolean) || !actual.equals(expected)) {
            fail(name, key + " expected Boolean " + expected + " got " + actual);
        }
    }

    private static void expectKeys(String name, Map<String, Object> status, String... keys) {
        Set<String> expected = new LinkedHashSet<>(Arrays.asList(keys));
        if (!status.keySet().equals(expected)) {
            fail(name, "expected keys " + expected + " got " + status.keySet());
        }
    }

    private static void expectLastSyncAt(
            String name, Map<String, Object> status, Long expected) {
        Object actual = status.get("lastSyncAt");
        if (!(actual instanceof Long) || !actual.equals(expected)) {
            fail(name, "lastSyncAt expected Long " + expected + " got " + actual);
        }
    }

    private static void expectUnmodifiable(String name, Map<String, Object> status) {
        try {
            status.put("extra", true);
            fail(name, "accepted put");
        } catch (UnsupportedOperationException expected) {
            return;
        }
    }

    public static void main(String[] args) {
        Map<String, Object> unavailable =
                WatchLinkStatus.status(false, true, true, true, 1700000000000L);
        expectBoolean("unavailable", unavailable, "paired", false);
        expectBoolean("unavailable", unavailable, "installed", false);
        expectBoolean("unavailable", unavailable, "reachable", false);

        Map<String, Object> allTrue =
                WatchLinkStatus.status(true, true, true, true, 1700000000000L);
        expectBoolean("all true", allTrue, "paired", true);
        expectBoolean("all true", allTrue, "installed", true);
        expectBoolean("all true", allTrue, "reachable", true);
        expectLastSyncAt("positive last sync", allTrue, 1700000000000L);
        expectKeys("positive last sync", allTrue,
                "paired", "installed", "reachable", "lastSyncAt");

        Map<String, Object> installedWithoutPaired =
                WatchLinkStatus.status(true, false, true, true, null);
        expectBoolean("installed without paired", installedWithoutPaired, "installed", false);

        Map<String, Object> reachableWithoutInstalled =
                WatchLinkStatus.status(true, true, false, true, null);
        expectBoolean("reachable without installed", reachableWithoutInstalled, "reachable", false);

        Map<String, Object> nullLastSync =
                WatchLinkStatus.status(true, true, true, true, null);
        expectKeys("null last sync", nullLastSync, "paired", "installed", "reachable");

        Map<String, Object> negativeLastSync =
                WatchLinkStatus.status(true, true, true, true, -1L);
        expectKeys("negative last sync", negativeLastSync, "paired", "installed", "reachable");
        expectUnmodifiable("unmodifiable", allTrue);

        System.out.println("WatchLinkStatusCheck ok");
    }
}
