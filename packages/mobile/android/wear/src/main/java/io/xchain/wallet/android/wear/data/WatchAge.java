// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear.data;

public final class WatchAge {
    public static final long AMBER_AFTER_MS = 900_000L;

    private static final long MINUTE_MS = 60_000L;
    private static final long HOUR_MS = 60L * MINUTE_MS;
    private static final long DAY_MS = 24L * HOUR_MS;

    private WatchAge() {}

    public enum Bucket {
        JUST_NOW("justNow"),
        MINUTES("minutes"),
        HOURS("hours"),
        DAY("day");

        private final String id;

        Bucket(String id) {
            this.id = id;
        }

        public String id() {
            return id;
        }
    }

    public static final class Age {
        public final Bucket bucket;
        public final long n;
        public final boolean amber;

        public Age(Bucket bucket, long n, boolean amber) {
            if (bucket == null) {
                throw new NullPointerException("bucket");
            }
            this.bucket = bucket;
            this.n = n;
            this.amber = amber;
        }

        @Override
        public boolean equals(Object other) {
            if (this == other) {
                return true;
            }
            if (!(other instanceof Age)) {
                return false;
            }
            Age age = (Age) other;
            return bucket == age.bucket && n == age.n && amber == age.amber;
        }

        @Override
        public int hashCode() {
            int result = bucket.hashCode();
            result = 31 * result + (int) (n ^ (n >>> 32));
            result = 31 * result + (amber ? 1 : 0);
            return result;
        }

        @Override
        public String toString() {
            return "Age{bucket=" + bucket + ", n=" + n + ", amber=" + amber + '}';
        }
    }

    public static Age of(long balancesAt, long now) {
        long elapsedMs = elapsedMs(balancesAt, now);
        boolean amber = elapsedMs > AMBER_AFTER_MS;

        if (elapsedMs < MINUTE_MS) {
            return new Age(Bucket.JUST_NOW, 0L, amber);
        }
        if (elapsedMs < HOUR_MS) {
            return new Age(Bucket.MINUTES, elapsedMs / MINUTE_MS, amber);
        }
        if (elapsedMs < DAY_MS) {
            return new Age(Bucket.HOURS, elapsedMs / HOUR_MS, amber);
        }
        return new Age(Bucket.DAY, elapsedMs / HOUR_MS, amber);
    }

    private static long elapsedMs(long balancesAt, long now) {
        if (balancesAt >= now) {
            return 0L;
        }
        long elapsedMs = now - balancesAt;
        return elapsedMs < 0L ? Long.MAX_VALUE : elapsedMs;
    }
}
