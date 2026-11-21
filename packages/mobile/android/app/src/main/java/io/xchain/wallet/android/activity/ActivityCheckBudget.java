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

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class ActivityCheckBudget {

    public static final int MAX_ADDRESSES = 20;
    public static final int PARALLEL = 4;
    public static final int REQUEST_TIMEOUT_MS = 10000;
    public static final int RUN_BUDGET_MS = 120000;

    private ActivityCheckBudget() {}

    public static List<String> pick(List<String> addresses, Map<String, Long> lastCheckedAt, int max) {
        if (max <= 0) {
            return new ArrayList<>();
        }

        Set<String> distinct = new LinkedHashSet<>(addresses);
        List<String> picked = new ArrayList<>(Math.min(max, distinct.size()));
        List<String> checked = new ArrayList<>();
        for (String address : distinct) {
            if (lastCheckedAt.get(address) == null) {
                picked.add(address);
                if (picked.size() == max) {
                    return picked;
                }
            } else {
                checked.add(address);
            }
        }

        checked.sort(Comparator.comparingLong(address -> lastCheckedAt.get(address)));
        for (String address : checked) {
            picked.add(address);
            if (picked.size() == max) {
                break;
            }
        }
        return picked;
    }

    public static boolean applyReads(Map<String, List<String>> baseline, Map<String, List<String>> reads) {
        boolean changed = false;
        for (Map.Entry<String, List<String>> read : reads.entrySet()) {
            List<String> value = read.getValue();
            if (value == null) {
                continue;
            }

            String address = read.getKey();
            if (!baseline.containsKey(address)) {
                baseline.put(address, value);
            } else if (!value.equals(baseline.get(address))) {
                baseline.put(address, value);
                changed = true;
            }
        }
        return changed;
    }
}
