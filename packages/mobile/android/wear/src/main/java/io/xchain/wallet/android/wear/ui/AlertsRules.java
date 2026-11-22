package io.xchain.wallet.android.wear.ui;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.function.ToLongFunction;

public final class AlertsRules {
    public static final int LIST_LIMIT = 20;

    private AlertsRules() {}

    public static <T> List<T> newestFirst(List<T> items, ToLongFunction<T> at) {
        if (items == null || items.isEmpty()) {
            return Collections.emptyList();
        }

        List<T> sorted = new ArrayList<>(items);
        sorted.sort(Comparator.comparingLong(at).reversed());
        if (sorted.size() > LIST_LIMIT) {
            sorted = new ArrayList<>(sorted.subList(0, LIST_LIMIT));
        }
        return Collections.unmodifiableList(sorted);
    }

    public static boolean hasUnread(boolean[] reads) {
        if (reads == null) {
            return false;
        }
        for (boolean read : reads) {
            if (!read) {
                return true;
            }
        }
        return false;
    }

    public static String emptyTextKey(int count) {
        return count <= 0 ? "w3.empty" : null;
    }

    public static String detailBody(String body) {
        return body == null || body.trim().isEmpty() ? null : body;
    }

    public static boolean isExpired(Long expiresAt, long now) {
        return expiresAt != null && expiresAt <= now;
    }
}
