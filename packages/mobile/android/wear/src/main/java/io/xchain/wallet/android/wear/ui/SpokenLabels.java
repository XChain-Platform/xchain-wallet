package io.xchain.wallet.android.wear.ui;

import java.util.ArrayList;
import java.util.List;

public final class SpokenLabels {
    public static final String SEPARATOR = ", ";
    public static final String HIDDEN_KEY = "state.amountHidden";
    public static final String UNAVAILABLE_KEY = "state.balanceUnavailable";

    private SpokenLabels() {}

    public static String lines(String... parts) {
        if (parts == null) {
            return "";
        }

        List<String> kept = new ArrayList<>();
        for (String part : parts) {
            if (part != null && !part.trim().isEmpty()) {
                kept.add(part);
            }
        }
        return String.join(SEPARATOR, kept);
    }

    public static String balanceRow(
            String name,
            String primary,
            String secondary,
            String pendingText,
            boolean redacted,
            boolean unavailable,
            String hiddenText,
            String unavailableText) {
        if (unavailable) {
            return lines(name, unavailableText);
        }
        if (redacted) {
            return lines(name, hiddenText);
        }
        return lines(name, primary, secondary, pendingText);
    }
}
