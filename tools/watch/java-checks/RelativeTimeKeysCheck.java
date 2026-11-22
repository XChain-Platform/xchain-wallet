import io.xchain.wallet.android.wear.data.RelativeTimeKeys;
import io.xchain.wallet.android.wear.data.RelativeTimeKeys.Key;

public final class RelativeTimeKeysCheck {
    private RelativeTimeKeysCheck() {
    }

    public static void main(String[] args) {
        checkKey(RelativeTimeKeys.ageKey("justNow", 5), "state.ageJustNow", 0,
                "age just now ignores stray count");
        checkKey(RelativeTimeKeys.ageKey("minutes", 12), "state.ageMinutes", 12,
                "age minutes");
        checkKey(RelativeTimeKeys.ageKey("hours", 23), "state.ageHours", 23,
                "age hours");
        checkKey(RelativeTimeKeys.ageKey("day", 24), "state.stale24h", 0,
                "age day");

        checkKey(RelativeTimeKeys.alertKey("justNow", 5), "w3.timeJustNow", 0,
                "alert just now ignores stray count");
        checkKey(RelativeTimeKeys.alertKey("minutes", 12), "w3.timeMinutes", 12,
                "alert minutes");
        checkKey(RelativeTimeKeys.alertKey("hours", 23), "w3.timeHours", 23,
                "alert hours");
        checkKey(RelativeTimeKeys.alertKey("day", 24), "w3.timeDays", 1,
                "alert 24 hours is one day");
        checkKey(RelativeTimeKeys.alertKey("day", 47), "w3.timeDays", 1,
                "alert 47 hours rounds down to one day");
        checkKey(RelativeTimeKeys.alertKey("day", 48), "w3.timeDays", 2,
                "alert 48 hours is two days");
        checkKey(RelativeTimeKeys.alertKey("day", 720), "w3.timeDays", 30,
                "alert 720 hours is 30 days");

        checkThrows(() -> RelativeTimeKeys.ageKey("unknown", 0),
                "age rejects unknown bucket");
        checkThrows(() -> RelativeTimeKeys.alertKey("unknown", 0),
                "alert rejects unknown bucket");
        checkThrows(() -> RelativeTimeKeys.ageKey("Day", 24),
                "age bucket ids are case sensitive");
        checkThrows(() -> RelativeTimeKeys.alertKey("Day", 24),
                "alert bucket ids are case sensitive");
        checkThrows(() -> RelativeTimeKeys.ageKey(null, 0),
                "age rejects null bucket");
        checkThrows(() -> RelativeTimeKeys.alertKey(null, 0),
                "alert rejects null bucket");
        checkThrows(() -> RelativeTimeKeys.ageKey("minutes", -1),
                "age rejects negative count");
        checkThrows(() -> RelativeTimeKeys.alertKey("minutes", -1),
                "alert rejects negative count");

        check(RelativeTimeKeys.fill("Updated {n} min ago", 12)
                        .equals("Updated 12 min ago"),
                "fill inserts minutes");
        check(RelativeTimeKeys.fill("{n} d ago", 0).equals("0 d ago"),
                "fill inserts zero");
        check(RelativeTimeKeys.fill("{n} of {n}", 3).equals("3 of 3"),
                "fill replaces every placeholder");
        check(RelativeTimeKeys.fill("Just now", 5).equals("Just now"),
                "fill keeps template without placeholder");

        Key first = RelativeTimeKeys.alertKey("minutes", 12);
        Key second = RelativeTimeKeys.alertKey("minutes", 12);
        check(first.equals(second), "equal keys compare equal");
        check(second.equals(first), "key equality is symmetric");
        check(first.hashCode() == second.hashCode(), "equal keys have equal hash codes");
        check(!first.equals(RelativeTimeKeys.alertKey("minutes", 13)),
                "different counts compare unequal");
        check(!first.equals(RelativeTimeKeys.ageKey("minutes", 12)),
                "different string keys compare unequal");
        check(!first.equals(null), "key does not equal null");
        check(!first.equals("w3.timeMinutes"), "key does not equal another type");
        check(first.toString().equals("Key{key='w3.timeMinutes', n=12}"),
                "key toString names fields");
    }

    private static void checkKey(Key actual, String expectedKey, int expectedN, String caseName) {
        check(actual.key.equals(expectedKey) && actual.n == expectedN, caseName);
    }

    private static void checkThrows(Runnable action, String caseName) {
        try {
            action.run();
            fail(caseName);
        } catch (IllegalArgumentException expected) {
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
