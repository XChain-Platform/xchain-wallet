package io.xchain.wallet.android.wear.nav;

public final class WatchScreenGraph {
    private WatchScreenGraph() {}

    public enum Screen {
        BALANCES("balances"),
        TOKEN_DETAIL("tokenDetail"),
        ALERTS("alerts"),
        ALERT_DETAIL("alertDetail"),
        RECEIVE("receive"),
        STATUS("status"),
        NOT_SET_UP("notSetUp");

        private final String route;

        Screen(String route) {
            this.route = route;
        }

        public String route() {
            return route;
        }
    }

    public static Screen root(boolean hasSnapshot, boolean enabled) {
        return hasSnapshot && enabled ? Screen.BALANCES : Screen.NOT_SET_UP;
    }

    public static String notSetUpTextKey(boolean hasSnapshot, boolean enabled) {
        if (!hasSnapshot) {
            return "state.openWalletOnPhone";
        }
        if (!enabled) {
            return "state.watchDisabled";
        }
        return null;
    }

    public static boolean canPush(Screen to, Screen from) {
        if (from == Screen.BALANCES) {
            return to == Screen.TOKEN_DETAIL
                    || to == Screen.ALERTS
                    || to == Screen.ALERT_DETAIL
                    || to == Screen.RECEIVE
                    || to == Screen.STATUS;
        }
        return from == Screen.ALERTS && to == Screen.ALERT_DETAIL;
    }
}
