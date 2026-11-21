package io.xchain.wallet.android.wear.data;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public final class GlanceRules {
    public static final int TOP_ROWS = 3;
    public static final long REFRESH_INTERVAL_MS = 300000L;

    private GlanceRules() {
    }

    public static boolean showsTotal(
            boolean showTotal,
            String session,
            boolean hidden,
            String totalText) {
        return showTotal
                && "unlocked".equals(session)
                && !hidden
                && totalText != null
                && !totalText.isEmpty();
    }

    public static boolean showsRows(String session, boolean hidden) {
        return "unlocked".equals(session) && !hidden;
    }

    public static <T> List<T> topRows(List<T> rows) {
        if (rows == null || rows.isEmpty()) {
            return Collections.emptyList();
        }

        int end = Math.min(TOP_ROWS, rows.size());
        return Collections.unmodifiableList(new ArrayList<>(rows.subList(0, end)));
    }

    public static int unreadCount(int count) {
        return Math.max(0, count);
    }

    public static long refreshDelayMs(long lastRefreshAtMs, long nowMs) {
        if (lastRefreshAtMs <= 0) {
            return 0;
        }
        if (nowMs < lastRefreshAtMs) {
            return REFRESH_INTERVAL_MS;
        }

        long elapsedMs = nowMs - lastRefreshAtMs;
        return elapsedMs >= REFRESH_INTERVAL_MS ? 0 : REFRESH_INTERVAL_MS - elapsedMs;
    }
}
