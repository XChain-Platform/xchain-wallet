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
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class ActivityCheckBudgetPickTest {

    @Test
    public void picksTwentyOldestFromTwentyFiveAddresses() {
        List<String> addresses = new ArrayList<>();
        Map<String, Long> lastCheckedAt = new HashMap<>();
        for (int i = 0; i < 25; i++) {
            String address = "address-" + i;
            addresses.add(address);
            lastCheckedAt.put(address, (long) (25 - i));
        }

        List<String> expected = new ArrayList<>();
        for (int i = 24; i >= 5; i--) {
            expected.add("address-" + i);
        }
        assertEquals(expected, ActivityCheckBudget.pick(addresses, lastCheckedAt, 20));
    }

    @Test
    public void countsDuplicateAddressesOnce() {
        List<String> addresses = Arrays.asList("a", "a", "b", "c", "b");
        Map<String, Long> lastCheckedAt = new HashMap<>();
        lastCheckedAt.put("a", 1L);
        lastCheckedAt.put("b", 2L);
        lastCheckedAt.put("c", 3L);

        assertEquals(Arrays.asList("a", "b", "c"), ActivityCheckBudget.pick(addresses, lastCheckedAt, 4));
    }

    @Test
    public void picksNeverCheckedAddressesFirstInInputOrder() {
        List<String> addresses = Arrays.asList("checked-new", "never-a", "checked-old", "never-b");
        Map<String, Long> lastCheckedAt = new HashMap<>();
        lastCheckedAt.put("checked-new", 20L);
        lastCheckedAt.put("checked-old", 10L);

        assertEquals(
                Arrays.asList("never-a", "never-b", "checked-old", "checked-new"),
                ActivityCheckBudget.pick(addresses, lastCheckedAt, 4));
    }

    @Test
    public void preservesInputOrderWhenLastCheckedTimesTie() {
        List<String> addresses = Arrays.asList("third", "first", "second");
        Map<String, Long> lastCheckedAt = new HashMap<>();
        lastCheckedAt.put("third", 2L);
        lastCheckedAt.put("first", 1L);
        lastCheckedAt.put("second", 1L);

        assertEquals(
                Arrays.asList("first", "second", "third"),
                ActivityCheckBudget.pick(addresses, lastCheckedAt, 3));
    }

    @Test
    public void returnsEmptyForZeroOrNegativeMax() {
        List<String> addresses = Arrays.asList("a", "b");
        Map<String, Long> lastCheckedAt = new HashMap<>();

        assertTrue(ActivityCheckBudget.pick(addresses, lastCheckedAt, 0).isEmpty());
        assertTrue(ActivityCheckBudget.pick(addresses, lastCheckedAt, -1).isEmpty());
    }

    @Test
    public void firstSightStoresTheReadWithoutReportingAChange() {
        Map<String, List<String>> baseline = new HashMap<>();
        Map<String, List<String>> reads = new HashMap<>();
        List<String> value = Arrays.asList("confirmed", "pending");
        reads.put("address", value);

        assertFalse(ActivityCheckBudget.applyReads(baseline, reads));
        assertEquals(value, baseline.get("address"));
    }

    @Test
    public void equalReadDoesNotReportAChange() {
        Map<String, List<String>> baseline = new HashMap<>();
        baseline.put("address", Arrays.asList("confirmed", "pending"));
        Map<String, List<String>> reads = new HashMap<>();
        reads.put("address", Arrays.asList("confirmed", "pending"));

        assertFalse(ActivityCheckBudget.applyReads(baseline, reads));
        assertEquals(Arrays.asList("confirmed", "pending"), baseline.get("address"));
    }

    @Test
    public void changedPendingStringUpdatesTheBaselineAndReportsAChange() {
        Map<String, List<String>> baseline = new HashMap<>();
        baseline.put("address", Arrays.asList("confirmed", "pending-old"));
        Map<String, List<String>> reads = new HashMap<>();
        reads.put("address", Arrays.asList("confirmed", "pending-new"));

        assertTrue(ActivityCheckBudget.applyReads(baseline, reads));
        assertEquals(Arrays.asList("confirmed", "pending-new"), baseline.get("address"));
    }

    @Test
    public void nullReadKeepsTheBaselineAndDoesNotReportAChange() {
        Map<String, List<String>> baseline = new HashMap<>();
        List<String> original = Arrays.asList("confirmed", "pending");
        baseline.put("address", original);
        Map<String, List<String>> reads = new LinkedHashMap<>();
        reads.put("address", null);
        reads.put("new-address", null);

        assertFalse(ActivityCheckBudget.applyReads(baseline, reads));
        assertEquals(original, baseline.get("address"));
        assertNull(baseline.get("new-address"));
        assertFalse(baseline.containsKey("new-address"));
    }
}
