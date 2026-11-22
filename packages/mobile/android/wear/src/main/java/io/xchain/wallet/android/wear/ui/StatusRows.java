package io.xchain.wallet.android.wear.ui;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Objects;

public final class StatusRows {
    public static final String TITLE_KEY = "state.status";

    public enum Kind {
        FLAG,
        AGE,
        NONE,
        SESSION,
        SESSION_UNKNOWN,
        TOGGLE,
        TEXT
    }

    public static final class Row {
        public final String labelKey;
        public final Kind kind;
        public final boolean on;
        public final Long balancesAt;
        public final String text;

        private Row(String labelKey, Kind kind, boolean on, Long balancesAt, String text) {
            this.labelKey = labelKey;
            this.kind = kind;
            this.on = on;
            this.balancesAt = balancesAt;
            this.text = text;
        }

        @Override
        public boolean equals(Object other) {
            if (this == other) {
                return true;
            }
            if (!(other instanceof Row)) {
                return false;
            }
            Row row = (Row) other;
            return on == row.on
                    && Objects.equals(labelKey, row.labelKey)
                    && kind == row.kind
                    && Objects.equals(balancesAt, row.balancesAt)
                    && Objects.equals(text, row.text);
        }

        @Override
        public int hashCode() {
            return Objects.hash(labelKey, kind, on, balancesAt, text);
        }

        @Override
        public String toString() {
            return "Row{"
                    + "labelKey='" + labelKey + '\''
                    + ", kind=" + kind
                    + ", on=" + on
                    + ", balancesAt=" + balancesAt
                    + ", text='" + text + '\''
                    + '}';
        }
    }

    private StatusRows() {}

    public static List<Row> rows(
            boolean reachable,
            Long balancesAt,
            String session,
            boolean hideAmounts,
            String appVersion) {
        List<Row> rows = new ArrayList<>(5);
        rows.add(new Row("state.phoneReachable", Kind.FLAG, reachable, null, null));
        rows.add(
                balancesAt == null
                        ? new Row("state.lastSync", Kind.NONE, false, null, null)
                        : new Row("state.lastSync", Kind.AGE, false, balancesAt, null));

        boolean knownSession = reachable
                && ("unlocked".equals(session) || "locked".equals(session));
        rows.add(
                knownSession
                        ? new Row(
                                "state.session",
                                Kind.SESSION,
                                "locked".equals(session),
                                null,
                                null)
                        : new Row(
                                "state.session",
                                Kind.SESSION_UNKNOWN,
                                false,
                                null,
                                null));
        rows.add(new Row("state.hideAmounts", Kind.TOGGLE, hideAmounts, null, null));
        rows.add(new Row("state.version", Kind.TEXT, false, null, appVersion));
        return Collections.unmodifiableList(rows);
    }

    public static String valueKey(Kind kind) {
        return kind == Kind.SESSION_UNKNOWN ? "state.sessionUnknown" : null;
    }
}
