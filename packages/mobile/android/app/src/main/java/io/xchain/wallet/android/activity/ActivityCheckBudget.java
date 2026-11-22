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
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

public final class ActivityCheckBudget {

    public static final int MAX_ADDRESSES = 20;
    public static final int PARALLEL = 4;
    public static final int REQUEST_TIMEOUT_MS = 10000;
    public static final int RUN_BUDGET_MS = 120000;

    public interface AddressReader {
        List<String> read(String address) throws Exception;
    }

    private ActivityCheckBudget() {}

    public static Map<String, List<String>> run(List<String> addresses, AddressReader reader) {
        return run(addresses, reader, PARALLEL, REQUEST_TIMEOUT_MS, RUN_BUDGET_MS);
    }

    static Map<String, List<String>> run(
            List<String> addresses,
            AddressReader reader,
            int parallel,
            long requestTimeoutMs,
            long runBudgetMs) {
        List<String> selected = new ArrayList<>(new LinkedHashSet<>(addresses));
        selected = selected.subList(0, Math.min(MAX_ADDRESSES, selected.size()));
        Map<String, List<String>> reads = new LinkedHashMap<>();
        ExecutorService executor = Executors.newFixedThreadPool(parallel, task -> {
            Thread thread = new Thread(task, "activity-check");
            thread.setDaemon(true);
            return thread;
        });
        long runDeadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(runBudgetMs);

        try {
            for (int start = 0; start < selected.size(); start += parallel) {
                int end = Math.min(start + parallel, selected.size());
                Map<String, Future<List<String>>> batch = new LinkedHashMap<>();
                for (String address : selected.subList(start, end)) {
                    batch.put(address, executor.submit(() -> reader.read(address)));
                }
                long requestDeadline = Math.min(
                        runDeadline,
                        System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(requestTimeoutMs));
                for (Map.Entry<String, Future<List<String>>> entry : batch.entrySet()) {
                    Future<List<String>> future = entry.getValue();
                    List<String> value = null;
                    try {
                        long remaining = requestDeadline - System.nanoTime();
                        if (remaining > 0) {
                            value = future.get(remaining, TimeUnit.NANOSECONDS);
                        } else if (future.isDone()) {
                            value = future.get();
                        } else {
                            future.cancel(true);
                        }
                    } catch (ExecutionException | TimeoutException e) {
                        future.cancel(true);
                    } catch (InterruptedException e) {
                        future.cancel(true);
                        Thread.currentThread().interrupt();
                    }
                    reads.put(entry.getKey(), value);
                }
                if (System.nanoTime() >= runDeadline || Thread.currentThread().isInterrupted()) {
                    break;
                }
            }
        } finally {
            executor.shutdownNow();
        }
        return reads;
    }

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
