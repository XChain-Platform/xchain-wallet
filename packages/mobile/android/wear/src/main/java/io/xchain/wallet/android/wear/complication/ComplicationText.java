package io.xchain.wallet.android.wear.complication;

import io.xchain.wallet.android.wear.data.GlanceRules;
import java.util.Objects;

public final class ComplicationText {
    private static final String BALANCES_TITLE_KEY = "g2.balances";
    private static final String BALANCES_TITLE_RESOURCE = "g2_balances";
    private static final String ALERTS_TITLE_KEY = "g2.alerts";
    private static final String ALERTS_TITLE_RESOURCE = "g2_alerts";

    private ComplicationText() {
    }

    public enum Kind {
        TOTAL,
        ALERTS
    }

    public static final class Content {
        public final Kind kind;
        public final String text;
        public final String titleKey;
        public final String titleResource;

        public Content(Kind kind, String text, String titleKey, String titleResource) {
            this.kind = kind;
            this.text = text;
            this.titleKey = titleKey;
            this.titleResource = titleResource;
        }

        @Override
        public boolean equals(Object other) {
            if (this == other) {
                return true;
            }
            if (!(other instanceof Content)) {
                return false;
            }
            Content content = (Content) other;
            return kind == content.kind
                    && Objects.equals(text, content.text)
                    && Objects.equals(titleKey, content.titleKey)
                    && Objects.equals(titleResource, content.titleResource);
        }

        @Override
        public int hashCode() {
            return Objects.hash(kind, text, titleKey, titleResource);
        }

        @Override
        public String toString() {
            return "Content{"
                    + "kind=" + kind
                    + ", text='" + text + '\''
                    + ", titleKey='" + titleKey + '\''
                    + ", titleResource='" + titleResource + '\''
                    + '}';
        }
    }

    public static Content shortText(String totalText, int unreadCount) {
        if (totalText != null && !totalText.isEmpty()) {
            return new Content(
                    Kind.TOTAL,
                    totalText,
                    BALANCES_TITLE_KEY,
                    BALANCES_TITLE_RESOURCE);
        }

        return new Content(
                Kind.ALERTS,
                Integer.toString(GlanceRules.unreadCount(unreadCount)),
                ALERTS_TITLE_KEY,
                ALERTS_TITLE_RESOURCE);
    }
}
