package io.xchain.wallet.android.wear.ui;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public final class StateBannerRules {
    public enum Banner {
        LOADING("state.loading"),
        LOCKED("state.locked"),
        UNREACHABLE("state.unreachable"),
        STALE_24H("state.stale24h");

        private final String textKey;

        Banner(String textKey) {
            this.textKey = textKey;
        }

        public String textKey() {
            return textKey;
        }
    }

    public enum AgeLine {
        AGE("state.age"),
        AGE_AMBER("state.ageAmber");

        private final String textKey;

        AgeLine(String textKey) {
            this.textKey = textKey;
        }

        public String textKey() {
            return textKey;
        }
    }

    private StateBannerRules() {
    }

    public static List<Banner> banners(
            boolean hasSnapshot,
            String session,
            boolean reachable,
            boolean pastDay) {
        List<Banner> banners = new ArrayList<>();
        if (!hasSnapshot) {
            banners.add(Banner.LOADING);
            return Collections.unmodifiableList(banners);
        }
        if ("locked".equals(session)) {
            banners.add(Banner.LOCKED);
        }
        if (!reachable) {
            banners.add(Banner.UNREACHABLE);
        }
        if (pastDay) {
            banners.add(Banner.STALE_24H);
        }
        return Collections.unmodifiableList(banners);
    }

    public static AgeLine ageLine(boolean hasSnapshot, boolean hasBalancesAt, boolean amber) {
        if (!hasSnapshot || !hasBalancesAt) {
            return null;
        }
        return amber ? AgeLine.AGE_AMBER : AgeLine.AGE;
    }
}
