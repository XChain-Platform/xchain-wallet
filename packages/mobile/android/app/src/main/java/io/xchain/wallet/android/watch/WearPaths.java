package io.xchain.wallet.android.watch;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

public final class WearPaths {

    public static final String PREFIX = "/xc/";
    public static final String INTENT_PREFIX = "/xc/intent/";
    public static final List<String> INTENT_KINDS = Collections.unmodifiableList(Arrays.asList(
            "refresh",
            "detailRequest",
            "openOnPhone",
            "markRead",
            "watchState"
    ));
    public static final String SNAPSHOT = "/xc/snapshot";
    public static final String STATE = "/xc/state";
    public static final int CHANNEL_THRESHOLD_BYTES = 100000;

    private WearPaths() {}

    public static String intentPath(String kind) {
        if (!INTENT_KINDS.contains(kind)) {
            throw new IllegalArgumentException("unknown intent kind");
        }
        return INTENT_PREFIX + kind;
    }

    public static String intentKind(String path) {
        if (path == null || !path.startsWith(INTENT_PREFIX)) {
            return null;
        }
        String kind = path.substring(INTENT_PREFIX.length());
        return INTENT_KINDS.contains(kind) ? kind : null;
    }

    public static String detailPath(String id) {
        if (id == null || id.isEmpty()) {
            throw new IllegalArgumentException("id must not be null or empty");
        }
        return PREFIX + "detail/" + id;
    }

    public static String imagePath(String hash) {
        if (hash == null || !hash.matches("[0-9a-f]{64}")) {
            throw new IllegalArgumentException("hash must be 64 lowercase hexadecimal characters");
        }
        return PREFIX + "image/" + hash;
    }

    public static boolean useChannel(int byteLength) {
        return byteLength > CHANNEL_THRESHOLD_BYTES;
    }

    public static boolean isDataItemPathAllowed(String path) {
        return STATE.equals(path);
    }

    public static boolean isWatchPath(String path) {
        return path != null && path.startsWith(PREFIX);
    }
}
