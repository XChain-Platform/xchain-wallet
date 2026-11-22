import io.xchain.wallet.android.watch.WearPaths;
import io.xchain.wallet.android.wear.data.IntentPaths;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.List;

public final class WearIntentPathsCheck {

    private static final List<String> EXPECTED_KINDS = Arrays.asList(
            "refresh",
            "detailRequest",
            "openOnPhone",
            "markRead",
            "watchState"
    );

    private WearIntentPathsCheck() {}

    public static void main(String[] args) {
        try {
            runChecks();
        } catch (Throwable failure) {
            System.err.println("FAIL: " + failure.getMessage());
            System.exit(1);
        }
    }

    private static void runChecks() throws Exception {
        require("/xc/intent/".equals(WearPaths.INTENT_PREFIX), "phone intent prefix");
        require("/xc/intent/".equals(IntentPaths.INTENT_PREFIX), "watch intent prefix");
        require(WearPaths.INTENT_PREFIX.startsWith(WearPaths.PREFIX), "phone intent prefix under wear prefix");
        require(IntentPaths.INTENT_PREFIX.startsWith(WearPaths.PREFIX), "watch intent prefix under wear prefix");
        require(EXPECTED_KINDS.equals(WearPaths.INTENT_KINDS), "phone intent kinds and order");
        require(EXPECTED_KINDS.equals(IntentPaths.INTENT_KINDS), "watch intent kinds and order");
        require(WearPaths.INTENT_KINDS.equals(IntentPaths.INTENT_KINDS), "phone and watch intent kinds equal");
        require(WearPaths.INTENT_KINDS.size() == 5, "phone intent kinds count");
        require(IntentPaths.INTENT_KINDS.size() == 5, "watch intent kinds count");
        requireUnmodifiable(WearPaths.INTENT_KINDS, "phone intent kinds unmodifiable");
        requireUnmodifiable(IntentPaths.INTENT_KINDS, "watch intent kinds unmodifiable");

        for (String kind : EXPECTED_KINDS) {
            String phonePath = WearPaths.intentPath(kind);
            String watchPath = IntentPaths.intentPath(kind);
            require(phonePath.equals(watchPath), "matching path for " + kind);
            require(kind.equals(WearPaths.intentKind(phonePath)), "phone kind round trip for " + kind);
            require(kind.equals(IntentPaths.intentKind(watchPath)), "watch kind round trip for " + kind);
            require(!WearPaths.isDataItemPathAllowed(phonePath), "intent excluded from DataItems for " + kind);
        }

        for (String kind : Arrays.asList(null, "", "Refresh", "unknown")) {
            requireIllegalArgument(() -> WearPaths.intentPath(kind), "phone rejects kind " + kind);
            requireIllegalArgument(() -> IntentPaths.intentPath(kind), "watch rejects kind " + kind);
        }

        for (String path : Arrays.asList(
                null,
                "/xc/intent/",
                "/xc/intent/refresh/x",
                "/xc/intent/Refresh",
                "/xc/intent/unknown",
                "/xc/intentrefresh",
                "/xc/refresh",
                "/xc/snapshot"
        )) {
            require(WearPaths.intentKind(path) == null, "phone rejects path " + path);
            require(IntentPaths.intentKind(path) == null, "watch rejects path " + path);
        }

        String schema = new String(Files.readAllBytes(Paths.get(
                "packages/core/src/watch/contract/intents.schema.json"
        )), StandardCharsets.UTF_8);
        for (String kind : EXPECTED_KINDS) {
            require(schema.contains("\"" + kind + "\":"), "schema defines " + kind);
        }
    }

    private static void require(boolean condition, String name) {
        if (!condition) {
            throw new AssertionError(name);
        }
    }

    private static void requireUnmodifiable(List<String> kinds, String name) {
        try {
            kinds.add("extra");
        } catch (UnsupportedOperationException expected) {
            return;
        }
        throw new AssertionError(name);
    }

    private static void requireIllegalArgument(Runnable action, String name) {
        try {
            action.run();
        } catch (IllegalArgumentException expected) {
            return;
        }
        throw new AssertionError(name);
    }
}
