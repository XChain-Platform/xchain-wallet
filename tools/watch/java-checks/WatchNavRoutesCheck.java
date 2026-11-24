import io.xchain.wallet.android.wear.nav.WatchNavRoutes;
import io.xchain.wallet.android.wear.nav.WatchScreenGraph.Screen;

public final class WatchNavRoutesCheck {
    private static final Screen[] SCREENS = {
        Screen.BALANCES,
        Screen.TOKEN_DETAIL,
        Screen.ALERTS,
        Screen.ALERT_DETAIL,
        Screen.RECEIVE,
        Screen.STATUS,
        Screen.NOT_SET_UP
    };

    private static final String[] PATTERNS = {
        "balances",
        "tokenDetail/{tokenId}",
        "alerts",
        "alertDetail/{alertId}",
        "receive",
        "status",
        "notSetUp"
    };

    private static final String[] IDS = {
        "bitcoin-mainnet:T01",
        "bitcoin-testnet:BTC",
        "bitcoin-mainnet:PEPECASH",
        "notification:tx-confirmed:send-01",
        "1023456789abcdef0123456789abcdef",
        "PEPECASH.sub",
        "a/b",
        "a b",
        "100%",
        "x?y#z&k=v",
        "{tokenId}",
        "é"
    };

    private static int checkCount;

    private WatchNavRoutesCheck() {}

    public static void main(String[] args) {
        try {
            runChecks();
            System.out.println("WatchNavRoutesCheck: " + checkCount + " checks passed");
        } catch (Throwable failure) {
            System.err.println("WatchNavRoutesCheck failed: " + failure.getMessage());
            System.exit(1);
        }
    }

    private static void runChecks() {
        check("tokenId".equals(WatchNavRoutes.TOKEN_ID_ARG), "token argument constant");
        check("alertId".equals(WatchNavRoutes.ALERT_ID_ARG), "alert argument constant");

        for (int index = 0; index < SCREENS.length; index++) {
            String pattern = WatchNavRoutes.pattern(SCREENS[index]);
            check(PATTERNS[index].equals(pattern), "pattern for " + SCREENS[index]);
            check(pattern.startsWith(SCREENS[index].route()),
                    "pattern starts with route for " + SCREENS[index]);
        }
        expectNullPointer(() -> WatchNavRoutes.pattern(null), "null pattern screen throws");

        for (String id : IDS) {
            String encoded = WatchNavRoutes.encode(id);
            check(containsOnlyEncodedCharacters(encoded), "encoded characters for " + id);
            check(id.equals(WatchNavRoutes.decode(encoded)), "decode round trip for " + id);
            check(id.equals(WatchNavRoutes.argument(WatchNavRoutes.tokenDetail(id),
                    Screen.TOKEN_DETAIL)), "token argument round trip for " + id);
            check(id.equals(WatchNavRoutes.argument(WatchNavRoutes.alertDetail(id),
                    Screen.ALERT_DETAIL)), "alert argument round trip for " + id);
        }

        check("bitcoin-mainnet%3AT01".equals(WatchNavRoutes.encode("bitcoin-mainnet:T01")),
                "colon encoding");
        check("a%20b".equals(WatchNavRoutes.encode("a b")), "space encoding");
        check("%C3%A9".equals(WatchNavRoutes.encode("é")), "UTF-8 encoding");
        check("PEPECASH.sub".equals(WatchNavRoutes.encode("PEPECASH.sub")),
                "unreserved dot encoding");

        check(WatchNavRoutes.decode("%") == null, "trailing percent is invalid");
        check(WatchNavRoutes.decode("%4") == null, "short escape is invalid");
        check(WatchNavRoutes.decode("%zz") == null, "non-hex escape is invalid");
        check(WatchNavRoutes.decode("%C3") == null, "incomplete UTF-8 is invalid");

        check(WatchNavRoutes.argument("alerts", Screen.ALERT_DETAIL) == null,
                "bare alerts has no argument");
        check(WatchNavRoutes.argument("tokenDetail", Screen.TOKEN_DETAIL) == null,
                "bare token detail has no argument");
        check(WatchNavRoutes.argument("tokenDetail/", Screen.TOKEN_DETAIL) == null,
                "empty token argument is invalid");
        check(WatchNavRoutes.argument("tokenDetail/a/b", Screen.TOKEN_DETAIL) == null,
                "additional path segment is invalid");
        check(WatchNavRoutes.argument("tokenDetail/a", Screen.ALERT_DETAIL) == null,
                "wrong detail screen is invalid");
        check(WatchNavRoutes.argument("tokenDetailX/a", Screen.TOKEN_DETAIL) == null,
                "route prefix is not enough");

        expectIllegalArgument(() -> WatchNavRoutes.tokenDetail(null),
                "null token id throws");
        expectIllegalArgument(() -> WatchNavRoutes.tokenDetail(""),
                "empty token id throws");
        expectIllegalArgument(() -> WatchNavRoutes.alertDetail(null),
                "null alert id throws");
        expectIllegalArgument(() -> WatchNavRoutes.alertDetail(""),
                "empty alert id throws");
    }

    private static boolean containsOnlyEncodedCharacters(String value) {
        for (int index = 0; index < value.length(); index++) {
            char current = value.charAt(index);
            if (current >= 'A' && current <= 'Z'
                    || current >= 'a' && current <= 'z'
                    || current >= '0' && current <= '9'
                    || current == '-'
                    || current == '.'
                    || current == '_'
                    || current == '~'
                    || current == '%') {
                continue;
            }
            return false;
        }
        return true;
    }

    private static void expectNullPointer(Runnable action, String caseName) {
        try {
            action.run();
            fail(caseName);
        } catch (NullPointerException expected) {
            check(true, caseName);
        }
    }

    private static void expectIllegalArgument(Runnable action, String caseName) {
        try {
            action.run();
            fail(caseName);
        } catch (IllegalArgumentException expected) {
            check(true, caseName);
        }
    }

    private static void check(boolean condition, String caseName) {
        if (!condition) {
            fail(caseName);
        }
        checkCount++;
    }

    private static void fail(String caseName) {
        throw new AssertionError(caseName);
    }
}
