package io.xchain.wallet.android.wear.data;

import java.util.Objects;

public final class RelativeTimeKeys {
    private RelativeTimeKeys() {
    }

    public static final class Key {
        public final String key;
        public final int n;

        private Key(String key, int n) {
            this.key = key;
            this.n = n;
        }

        @Override
        public boolean equals(Object other) {
            if (this == other) {
                return true;
            }
            if (!(other instanceof Key)) {
                return false;
            }
            Key that = (Key) other;
            return n == that.n && key.equals(that.key);
        }

        @Override
        public int hashCode() {
            return Objects.hash(key, n);
        }

        @Override
        public String toString() {
            return "Key{key='" + key + "', n=" + n + '}';
        }
    }

    public static Key ageKey(String bucketId, int n) {
        requireValid(bucketId, n);
        switch (bucketId) {
            case "justNow":
                return new Key("state.ageJustNow", 0);
            case "minutes":
                return new Key("state.ageMinutes", n);
            case "hours":
                return new Key("state.ageHours", n);
            case "day":
                return new Key("state.stale24h", 0);
            default:
                throw unknownBucket(bucketId);
        }
    }

    public static Key alertKey(String bucketId, int n) {
        requireValid(bucketId, n);
        switch (bucketId) {
            case "justNow":
                return new Key("w3.timeJustNow", 0);
            case "minutes":
                return new Key("w3.timeMinutes", n);
            case "hours":
                return new Key("w3.timeHours", n);
            case "day":
                return new Key("w3.timeDays", n / 24);
            default:
                throw unknownBucket(bucketId);
        }
    }

    public static String fill(String template, int n) {
        return template.replace("{n}", Integer.toString(n));
    }

    private static void requireValid(String bucketId, int n) {
        if (bucketId == null) {
            throw new IllegalArgumentException("bucketId must not be null");
        }
        if (n < 0) {
            throw new IllegalArgumentException("n must not be negative");
        }
    }

    private static IllegalArgumentException unknownBucket(String bucketId) {
        return new IllegalArgumentException("unknown bucketId: " + bucketId);
    }
}
