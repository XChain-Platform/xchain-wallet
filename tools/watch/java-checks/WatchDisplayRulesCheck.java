import io.xchain.wallet.android.wear.data.WatchDisplayRules;
import io.xchain.wallet.android.wear.data.WatchDisplayRules.UnitsMode;

public final class WatchDisplayRulesCheck {
    private WatchDisplayRulesCheck() {}

    public static void main(String[] args) {
        check(WatchDisplayRules.seed("units") == UnitsMode.UNITS, "seed units");
        check(WatchDisplayRules.seed("fiat") == UnitsMode.FIAT, "seed fiat");
        check(WatchDisplayRules.seed(null) == UnitsMode.FIAT, "seed null");
        check(WatchDisplayRules.seed("") == UnitsMode.FIAT, "seed empty");
        check(WatchDisplayRules.seed("Units") == UnitsMode.FIAT, "seed Units");

        check(
                WatchDisplayRules.resolve(UnitsMode.FIAT, "units", false) == UnitsMode.FIAT,
                "stored choice wins over seed");
        check(
                WatchDisplayRules.resolve(null, "units", false) == UnitsMode.UNITS,
                "null stored choice uses seed");
        check(
                WatchDisplayRules.resolve(UnitsMode.FIAT, "units", true) == UnitsMode.UNITS,
                "test network ignores stored fiat");
        check(
                WatchDisplayRules.resolve(null, "fiat", true) == UnitsMode.UNITS,
                "test network ignores fiat seed");

        check(WatchDisplayRules.canToggle(false), "main network can toggle");
        check(!WatchDisplayRules.canToggle(true), "test network cannot toggle");

        UnitsMode toggledFiat = WatchDisplayRules.toggled(UnitsMode.FIAT, false);
        check(toggledFiat == UnitsMode.UNITS, "fiat toggles to units");
        check(
                WatchDisplayRules.toggled(toggledFiat, false) == UnitsMode.FIAT,
                "toggling twice returns fiat");
        UnitsMode toggledUnits = WatchDisplayRules.toggled(UnitsMode.UNITS, false);
        check(toggledUnits == UnitsMode.FIAT, "units toggles to fiat");
        check(
                WatchDisplayRules.toggled(toggledUnits, false) == UnitsMode.UNITS,
                "toggling twice returns units");
        check(
                WatchDisplayRules.toggled(UnitsMode.FIAT, true) == UnitsMode.UNITS,
                "test network toggle stays units from fiat");
        check(
                WatchDisplayRules.toggled(UnitsMode.UNITS, true) == UnitsMode.UNITS,
                "test network toggle stays units from units");

        for (int mask = 0; mask < 8; mask++) {
            boolean ambient = (mask & 4) != 0;
            boolean phoneHidden = (mask & 2) != 0;
            boolean hideAmounts = (mask & 1) != 0;
            boolean expected = ambient || phoneHidden || hideAmounts;
            check(
                    WatchDisplayRules.isRedacted(ambient, phoneHidden, hideAmounts) == expected,
                    "redaction combination " + mask);
        }

        check(WatchDisplayRules.showsPriceLine(false, false, 2), "line shown for 2 points");
        check(WatchDisplayRules.showsPriceLine(false, false, 48), "line shown for 48 points");
        check(!WatchDisplayRules.showsPriceLine(false, false, 0), "line hidden for 0 points");
        check(!WatchDisplayRules.showsPriceLine(false, false, 1), "line hidden for 1 point");
        check(!WatchDisplayRules.showsPriceLine(true, false, 2), "line hidden when redacted");
        check(!WatchDisplayRules.showsPriceLine(true, false, 48), "long line hidden when redacted");
        check(!WatchDisplayRules.showsPriceLine(false, true, 2), "line hidden when unpriced");
        check(!WatchDisplayRules.showsPriceLine(false, true, 48), "long line hidden when unpriced");
    }

    private static void check(boolean condition, String name) {
        if (!condition) {
            System.err.println("FAILED: " + name);
            System.exit(1);
        }
    }
}
