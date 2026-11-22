import io.xchain.wallet.android.wear.nav.WatchScreenGraph;
import io.xchain.wallet.android.wear.nav.WatchScreenGraph.Screen;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

public final class WatchScreenGraphCheck {
    private static final Screen[] SCREENS = {
        Screen.BALANCES,
        Screen.TOKEN_DETAIL,
        Screen.ALERTS,
        Screen.ALERT_DETAIL,
        Screen.RECEIVE,
        Screen.STATUS,
        Screen.NOT_SET_UP
    };

    private static final String[] ROUTES = {
        "balances",
        "tokenDetail",
        "alerts",
        "alertDetail",
        "receive",
        "status",
        "notSetUp"
    };

    private static final boolean[][] CAN_PUSH = {
        {false, true, true, true, true, true, false},
        {false, false, false, false, false, false, false},
        {false, false, false, true, false, false, false},
        {false, false, false, false, false, false, false},
        {false, false, false, false, false, false, false},
        {false, false, false, false, false, false, false},
        {false, false, false, false, false, false, false}
    };

    private WatchScreenGraphCheck() {}

    public static void main(String[] args) {
        try {
            runChecks();
            System.out.println("WatchScreenGraphCheck: 68 checks passed");
        } catch (Throwable failure) {
            System.err.println("WatchScreenGraphCheck failed: " + failure.getMessage());
            System.exit(1);
        }
    }

    private static void runChecks() throws Exception {
        check(WatchScreenGraph.root(false, false) == Screen.NOT_SET_UP,
                "root without snapshot and disabled");
        check(WatchScreenGraph.root(false, true) == Screen.NOT_SET_UP,
                "root without snapshot but enabled");
        check(WatchScreenGraph.root(true, false) == Screen.NOT_SET_UP,
                "root with disabled snapshot");
        check(WatchScreenGraph.root(true, true) == Screen.BALANCES,
                "root with enabled snapshot");

        String openWalletKey = WatchScreenGraph.notSetUpTextKey(false, false);
        String openWalletEnabledKey = WatchScreenGraph.notSetUpTextKey(false, true);
        String watchDisabledKey = WatchScreenGraph.notSetUpTextKey(true, false);
        check("state.openWalletOnPhone".equals(openWalletKey),
                "text key without snapshot and disabled");
        check("state.openWalletOnPhone".equals(openWalletEnabledKey),
                "text key without snapshot but enabled");
        check("state.watchDisabled".equals(watchDisabledKey),
                "text key with disabled snapshot");
        check(WatchScreenGraph.notSetUpTextKey(true, true) == null,
                "text key with enabled snapshot");

        Path stringsPath = Paths.get(
                "packages/core/src/watch/contract/strings-balances.json");
        String strings = new String(Files.readAllBytes(stringsPath), StandardCharsets.UTF_8);
        check(strings.contains("\"" + openWalletKey + "\""),
                "contract contains " + openWalletKey);
        check(strings.contains("\"" + watchDisabledKey + "\""),
                "contract contains " + watchDisabledKey);

        Screen[] actualScreens = Screen.values();
        check(Arrays.equals(actualScreens, SCREENS), "screen enum values and order");
        Set<String> distinctRoutes = new HashSet<>();
        for (int index = 0; index < SCREENS.length; index++) {
            String actualRoute = SCREENS[index].route();
            check(ROUTES[index].equals(actualRoute),
                    "route for " + SCREENS[index] + " expected " + ROUTES[index]
                            + " but was " + actualRoute);
            distinctRoutes.add(actualRoute);
        }
        check(distinctRoutes.size() == SCREENS.length, "routes are distinct");

        for (int fromIndex = 0; fromIndex < SCREENS.length; fromIndex++) {
            for (int toIndex = 0; toIndex < SCREENS.length; toIndex++) {
                Screen from = SCREENS[fromIndex];
                Screen to = SCREENS[toIndex];
                boolean actual = WatchScreenGraph.canPush(to, from);
                check(actual == CAN_PUSH[fromIndex][toIndex],
                        "canPush from " + from + " to " + to + " expected "
                                + CAN_PUSH[fromIndex][toIndex] + " but was " + actual);
            }
        }
    }

    private static void check(boolean condition, String caseName) {
        if (!condition) {
            throw new AssertionError(caseName);
        }
    }
}
