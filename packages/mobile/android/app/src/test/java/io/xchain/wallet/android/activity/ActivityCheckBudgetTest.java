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

import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

public class ActivityCheckBudgetTest {

    @Test
    public void exposesAndroidDesignBudgets() {
        assertEquals(20, ActivityCheckBudget.MAX_ADDRESSES);
        assertEquals(4, ActivityCheckBudget.PARALLEL);
        assertEquals(10000, ActivityCheckBudget.REQUEST_TIMEOUT_MS);
        assertEquals(120000, ActivityCheckBudget.RUN_BUDGET_MS);
    }

    @Test
    public void readsAtMostFourAddressesAtOnce() {
        List<String> addresses = new ArrayList<>();
        for (int i = 0; i < 12; i++) {
            addresses.add("address-" + i);
        }
        AtomicInteger active = new AtomicInteger();
        AtomicInteger mostActive = new AtomicInteger();
        CountDownLatch firstFour = new CountDownLatch(4);

        Map<String, List<String>> reads = ActivityCheckBudget.run(addresses, address -> {
            int nowActive = active.incrementAndGet();
            mostActive.accumulateAndGet(nowActive, Math::max);
            firstFour.countDown();
            assertTrue(firstFour.await(2, TimeUnit.SECONDS));
            active.decrementAndGet();
            return Arrays.asList(address, "pending");
        });

        assertEquals(4, mostActive.get());
        assertEquals(12, reads.size());
        assertEquals(Arrays.asList("address-7", "pending"), reads.get("address-7"));
    }

    @Test
    public void capsDistinctReadsAtTwentyAddresses() {
        List<String> addresses = new ArrayList<>();
        for (int i = 0; i < 25; i++) {
            addresses.add("address-" + i);
        }
        addresses.add("address-0");
        AtomicInteger calls = new AtomicInteger();

        Map<String, List<String>> reads = ActivityCheckBudget.run(addresses, address -> {
            calls.incrementAndGet();
            return Arrays.asList("confirmed", "pending");
        });

        assertEquals(20, calls.get());
        assertEquals(20, reads.size());
        assertTrue(reads.containsKey("address-19"));
    }

    @Test
    public void recordsThrownAndTimedOutReadsAsFailures() {
        Map<String, List<String>> reads = ActivityCheckBudget.run(
                Arrays.asList("ok", "throws", "slow"),
                address -> {
                    if (address.equals("throws")) {
                        throw new IllegalStateException("failed");
                    }
                    if (address.equals("slow")) {
                        Thread.sleep(5000);
                    }
                    return Arrays.asList(address, "pending");
                },
                3,
                50,
                1000);

        assertEquals(Arrays.asList("ok", "pending"), reads.get("ok"));
        assertTrue(reads.containsKey("throws"));
        assertNull(reads.get("throws"));
        assertTrue(reads.containsKey("slow"));
        assertNull(reads.get("slow"));
    }

    @Test
    public void runBudgetStopsLaterBatches() {
        Map<String, List<String>> reads = ActivityCheckBudget.run(
                Arrays.asList("first", "second"),
                address -> {
                    Thread.sleep(5000);
                    return Arrays.asList(address, "pending");
                },
                1,
                1000,
                50);

        assertEquals(1, reads.size());
        assertTrue(reads.containsKey("first"));
        assertNull(reads.get("first"));
    }
}
