package io.xchain.wallet.android.wear.data;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

public final class IntentPaths {

    public static final String INTENT_PREFIX = "/xc/intent/";
    public static final List<String> INTENT_KINDS = Collections.unmodifiableList(Arrays.asList(
            "refresh",
            "detailRequest",
            "openOnPhone",
            "markRead",
            "watchState"
    ));

    private IntentPaths() {}

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
}
