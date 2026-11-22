// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import io.xchain.wallet.android.wear.data.WatchAge;

public final class WatchAgeCheck {
    private WatchAgeCheck() {}

    public static void main(String[] args) {
        checkAge("elapsed 0", 0L, WatchAge.Bucket.JUST_NOW, 0L, false);
        checkAge("elapsed 59999 ms", 59_999L, WatchAge.Bucket.JUST_NOW, 0L, false);
        checkAge("elapsed 60000 ms", 60_000L, WatchAge.Bucket.MINUTES, 1L, false);
        checkAge("exactly 15 minutes not amber", 900_000L, WatchAge.Bucket.MINUTES, 15L, false);
        checkAge("15 minutes plus 1 ms amber", 900_001L, WatchAge.Bucket.MINUTES, 15L, true);
        checkAge("59 minutes 59 s", 3_599_000L, WatchAge.Bucket.MINUTES, 59L, true);
        checkAge("60 minutes", 3_600_000L, WatchAge.Bucket.HOURS, 1L, true);
        checkAge("23 h 59 min", 86_340_000L, WatchAge.Bucket.HOURS, 23L, true);
        checkAge("24 h", 86_400_000L, WatchAge.Bucket.DAY, 24L, true);
        checkAge("50 h", 180_000_000L, WatchAge.Bucket.DAY, 50L, true);

        WatchAge.Age future = WatchAge.of(60_000L, 0L);
        check("balancesAt one minute in the future", future.equals(
                new WatchAge.Age(WatchAge.Bucket.JUST_NOW, 0L, false)));

        check("JUST_NOW id", "justNow".equals(WatchAge.Bucket.JUST_NOW.id()));
        check("MINUTES id", "minutes".equals(WatchAge.Bucket.MINUTES.id()));
        check("HOURS id", "hours".equals(WatchAge.Bucket.HOURS.id()));
        check("DAY id", "day".equals(WatchAge.Bucket.DAY.id()));

        WatchAge.Age age = WatchAge.of(0L, 900_001L);
        WatchAge.Age same = new WatchAge.Age(WatchAge.Bucket.MINUTES, 15L, true);
        check("Age equals same values", age.equals(same) && same.equals(age));
        check("equal Age hashCode", age.hashCode() == same.hashCode());
        check("Age unequal bucket", !age.equals(
                new WatchAge.Age(WatchAge.Bucket.HOURS, 15L, true)));
        check("Age unequal n", !age.equals(
                new WatchAge.Age(WatchAge.Bucket.MINUTES, 16L, true)));
        check("Age unequal amber", !age.equals(
                new WatchAge.Age(WatchAge.Bucket.MINUTES, 15L, false)));
        check("Age unequal null", !age.equals(null));
        check("Age unequal other type", !age.equals("age"));
    }

    private static void checkAge(
            String name,
            long elapsedMs,
            WatchAge.Bucket bucket,
            long n,
            boolean amber) {
        WatchAge.Age expected = new WatchAge.Age(bucket, n, amber);
        check(name, WatchAge.of(0L, elapsedMs).equals(expected));
    }

    private static void check(String name, boolean passed) {
        if (!passed) {
            System.err.println("FAILED: " + name);
            System.exit(1);
        }
    }
}
