import io.xchain.wallet.android.wear.ui.StatusRows;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;

public final class StatusRowsCheck {
    private static final String[] LABEL_KEYS = {
        "state.phoneReachable",
        "state.lastSync",
        "state.session",
        "state.hideAmounts",
        "state.version"
    };

    private StatusRowsCheck() {}

    public static void main(String[] args) throws Exception {
        checkReachableUnlocked();
        checkReachableLocked();
        checkUnreachableStoredLocked();
        checkUnknownSessions();
        checkNoSnapshot();
        checkLabelOrder();
        checkUnmodifiable();
        checkValueKeys();
        checkRowValueSemantics();
        checkContractKeys();
    }

    private static void checkReachableUnlocked() {
        List<StatusRows.Row> rows = StatusRows.rows(true, 101L, "unlocked", false, "1.2.3");
        require(rows.size() == 5, "reachable and unlocked: five rows");
        requireRow(rows.get(0), "state.phoneReachable", StatusRows.Kind.FLAG, true, null, null,
                "reachable and unlocked: reachable row");
        requireRow(rows.get(1), "state.lastSync", StatusRows.Kind.AGE, false, 101L, null,
                "reachable and unlocked: age row");
        requireRow(rows.get(2), "state.session", StatusRows.Kind.SESSION, false, null, null,
                "reachable and unlocked: session row");
        requireRow(rows.get(3), "state.hideAmounts", StatusRows.Kind.TOGGLE, false, null, null,
                "reachable and unlocked: toggle row");
        requireRow(rows.get(4), "state.version", StatusRows.Kind.TEXT, false, null, "1.2.3",
                "reachable and unlocked: version row");
    }

    private static void checkReachableLocked() {
        StatusRows.Row row = StatusRows.rows(true, 101L, "locked", true, "1.2.3").get(2);
        requireRow(row, "state.session", StatusRows.Kind.SESSION, true, null, null,
                "reachable and locked");
    }

    private static void checkUnreachableStoredLocked() {
        StatusRows.Row row = StatusRows.rows(false, 101L, "locked", false, "1.2.3").get(2);
        requireRow(row, "state.session", StatusRows.Kind.SESSION_UNKNOWN, false, null, null,
                "unreachable with stored locked");
    }

    private static void checkUnknownSessions() {
        String[] sessions = {null, "", "Unlocked"};
        for (String session : sessions) {
            StatusRows.Row row = StatusRows.rows(true, 101L, session, false, "1.2.3").get(2);
            require(row.kind == StatusRows.Kind.SESSION_UNKNOWN,
                    "reachable unknown session: " + String.valueOf(session));
        }
    }

    private static void checkNoSnapshot() {
        StatusRows.Row row = StatusRows.rows(true, null, "unlocked", false, "1.2.3").get(1);
        requireRow(row, "state.lastSync", StatusRows.Kind.NONE, false, null, null,
                "null balancesAt gives NONE");
    }

    private static void checkLabelOrder() {
        List<StatusRows.Row> rows = StatusRows.rows(true, 101L, "unlocked", false, "1.2.3");
        for (int index = 0; index < LABEL_KEYS.length; index += 1) {
            require(LABEL_KEYS[index].equals(rows.get(index).labelKey),
                    "five labels in order: index " + index);
        }
    }

    private static void checkUnmodifiable() {
        List<StatusRows.Row> rows = StatusRows.rows(true, 101L, "unlocked", false, "1.2.3");
        try {
            rows.add(rows.get(0));
            fail("returned list refuses add");
        } catch (UnsupportedOperationException expected) {
            return;
        }
    }

    private static void checkValueKeys() {
        for (StatusRows.Kind kind : StatusRows.Kind.values()) {
            String expected = kind == StatusRows.Kind.SESSION_UNKNOWN
                    ? "state.sessionUnknown"
                    : null;
            require(equal(expected, StatusRows.valueKey(kind)), "valueKey for " + kind);
        }
    }

    private static void checkRowValueSemantics() {
        StatusRows.Row left = StatusRows.rows(true, 101L, "locked", false, "1.2.3").get(2);
        StatusRows.Row equal = StatusRows.rows(true, 101L, "locked", false, "1.2.3").get(2);
        StatusRows.Row different = StatusRows.rows(true, 101L, "unlocked", false, "1.2.3").get(2);
        require(left.equals(equal), "Row equals equal values");
        require(left.hashCode() == equal.hashCode(), "Row hashCode equal values");
        require(!left.equals(different), "Row equals different values");
        require(left.toString().contains("kind=SESSION"), "Row toString fields");
    }

    private static void checkContractKeys() throws Exception {
        String json = Files.readString(
                Path.of("packages/core/src/watch/contract/strings-balances.json"),
                StandardCharsets.UTF_8);
        List<String> keys = Arrays.asList(
                StatusRows.TITLE_KEY,
                LABEL_KEYS[0],
                LABEL_KEYS[1],
                LABEL_KEYS[2],
                LABEL_KEYS[3],
                LABEL_KEYS[4],
                "state.sessionUnknown");
        for (String key : keys) {
            require(json.contains("\"" + key + "\""), "quoted contract key: " + key);
        }
    }

    private static void requireRow(
            StatusRows.Row row,
            String labelKey,
            StatusRows.Kind kind,
            boolean on,
            Long balancesAt,
            String text,
            String name) {
        require(labelKey.equals(row.labelKey), name + " labelKey");
        require(kind == row.kind, name + " kind");
        require(on == row.on, name + " on");
        require(equal(balancesAt, row.balancesAt), name + " balancesAt");
        require(equal(text, row.text), name + " text");
    }

    private static boolean equal(Object left, Object right) {
        return left == null ? right == null : left.equals(right);
    }

    private static void require(boolean condition, String name) {
        if (!condition) {
            fail(name);
        }
    }

    private static void fail(String name) {
        System.err.println("FAIL: " + name);
        System.exit(1);
    }
}
