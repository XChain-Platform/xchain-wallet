package io.xchain.wallet.android.wear.data;

import java.util.Objects;
import java.util.regex.Pattern;

public final class WatchPaths {
    public static final String PREFIX = "/xc/";
    public static final String SNAPSHOT = "/xc/snapshot";
    public static final String STATE = "/xc/state";
    public static final String DETAIL_PREFIX = "/xc/detail/";
    public static final String IMAGE_PREFIX = "/xc/image/";
    public static final String PHONE_CAPABILITY = "xchain_phone";

    private static final Pattern IMAGE_HASH = Pattern.compile("[0-9a-f]{64}");

    private WatchPaths() {
    }

    public enum Kind {
        SNAPSHOT,
        STATE,
        DETAIL,
        IMAGE
    }

    public static final class Incoming {
        public final Kind kind;
        public final String key;

        public Incoming(Kind kind, String key) {
            this.kind = Objects.requireNonNull(kind, "kind");
            this.key = key;
        }

        @Override
        public boolean equals(Object other) {
            if (this == other) {
                return true;
            }
            if (!(other instanceof Incoming)) {
                return false;
            }
            Incoming incoming = (Incoming) other;
            return kind == incoming.kind && Objects.equals(key, incoming.key);
        }

        @Override
        public int hashCode() {
            return Objects.hash(kind, key);
        }

        @Override
        public String toString() {
            return "Incoming{kind=" + kind + ", key=" + key + '}';
        }
    }

    public static Incoming classify(String path) {
        if (SNAPSHOT.equals(path)) {
            return new Incoming(Kind.SNAPSHOT, null);
        }
        if (STATE.equals(path)) {
            return new Incoming(Kind.STATE, null);
        }
        if (path == null) {
            return null;
        }
        if (path.startsWith(DETAIL_PREFIX)) {
            String id = path.substring(DETAIL_PREFIX.length());
            return id.isEmpty() ? null : new Incoming(Kind.DETAIL, id);
        }
        if (path.startsWith(IMAGE_PREFIX)) {
            String hash = path.substring(IMAGE_PREFIX.length());
            return IMAGE_HASH.matcher(hash).matches()
                    ? new Incoming(Kind.IMAGE, hash)
                    : null;
        }
        return null;
    }
}
