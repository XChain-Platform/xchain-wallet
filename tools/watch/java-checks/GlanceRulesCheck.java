import io.xchain.wallet.android.wear.data.GlanceRules;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

public final class GlanceRulesCheck {
    private GlanceRulesCheck() {
    }

    public static void main(String[] args) {
        check(GlanceRules.showsTotal(true, "unlocked", false, "$42"),
                "total kept when shown, unlocked and not hidden");
        check(!GlanceRules.showsTotal(false, "unlocked", false, "$42"),
                "total dropped when Show total is off");
        check(!GlanceRules.showsTotal(true, "locked", false, "$42"),
                "total dropped when locked");
        check(!GlanceRules.showsTotal(true, null, false, "$42"),
                "total dropped when session is null");
        check(!GlanceRules.showsTotal(true, "expired", false, "$42"),
                "total dropped when session is not unlocked");
        check(!GlanceRules.showsTotal(true, "unlocked", true, "$42"),
                "total dropped when hidden");
        check(!GlanceRules.showsTotal(true, "unlocked", false, null),
                "total dropped for null text");
        check(!GlanceRules.showsTotal(true, "unlocked", false, ""),
                "total dropped for empty text");

        check(GlanceRules.showsRows("unlocked", false),
                "rows shown when unlocked and not hidden");
        check(!GlanceRules.showsRows("locked", false),
                "rows dropped when locked");
        check(!GlanceRules.showsRows(null, false),
                "rows dropped when session is null");
        check(!GlanceRules.showsRows("expired", false),
                "rows dropped when session is not unlocked");
        check(!GlanceRules.showsRows("unlocked", true),
                "rows dropped when hidden");

        check(GlanceRules.topRows(Collections.emptyList()).isEmpty(),
                "top rows keeps zero entries");
        check(GlanceRules.topRows(Arrays.asList("a", "b")).equals(Arrays.asList("a", "b")),
                "top rows keeps two entries");
        check(GlanceRules.topRows(Arrays.asList("a", "b", "c"))
                        .equals(Arrays.asList("a", "b", "c")),
                "top rows keeps three entries");
        List<String> topFive = GlanceRules.topRows(Arrays.asList("a", "b", "c", "d", "e"));
        check(topFive.equals(Arrays.asList("a", "b", "c")),
                "top rows limits five entries");
        check(GlanceRules.topRows(null).isEmpty(),
                "top rows handles null");
        checkRefusesAdd(topFive);

        check(GlanceRules.unreadCount(-1) == 0, "unread clamps negative count");
        check(GlanceRules.unreadCount(0) == 0, "unread keeps zero count");
        check(GlanceRules.unreadCount(7) == 7, "unread keeps positive count");

        check(GlanceRules.refreshDelayMs(0, 1000) == 0,
                "refresh delay allows never refreshed");
        check(GlanceRules.refreshDelayMs(1000, 300999) == 1,
                "refresh delay leaves one millisecond");
        check(GlanceRules.refreshDelayMs(1000, 301000) == 0,
                "refresh delay allows exact interval");
        check(GlanceRules.refreshDelayMs(1000, 999) == GlanceRules.REFRESH_INTERVAL_MS,
                "refresh delay resets after clock moves back");
    }

    private static void checkRefusesAdd(List<String> rows) {
        try {
            rows.add("d");
            fail("top rows returned list refuses add");
        } catch (UnsupportedOperationException expected) {
            return;
        }
    }

    private static void check(boolean condition, String caseName) {
        if (!condition) {
            fail(caseName);
        }
    }

    private static void fail(String caseName) {
        System.err.println("FAILED: " + caseName);
        System.exit(1);
    }
}
