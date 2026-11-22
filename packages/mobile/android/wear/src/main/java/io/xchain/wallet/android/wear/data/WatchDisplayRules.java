package io.xchain.wallet.android.wear.data;

public final class WatchDisplayRules {
    public enum UnitsMode {
        FIAT,
        UNITS
    }

    private WatchDisplayRules() {}

    public static UnitsMode seed(String unitDefault) {
        return "units".equals(unitDefault) ? UnitsMode.UNITS : UnitsMode.FIAT;
    }

    public static UnitsMode resolve(UnitsMode stored, String unitDefault, boolean isTest) {
        if (isTest) {
            return UnitsMode.UNITS;
        }
        return stored != null ? stored : seed(unitDefault);
    }

    public static boolean canToggle(boolean isTest) {
        return !isTest;
    }

    public static UnitsMode toggled(UnitsMode mode, boolean isTest) {
        if (isTest) {
            return UnitsMode.UNITS;
        }
        return mode == UnitsMode.UNITS ? UnitsMode.FIAT : UnitsMode.UNITS;
    }

    public static boolean isRedacted(boolean ambient, boolean phoneHidden, boolean hideAmounts) {
        return ambient || phoneHidden || hideAmounts;
    }

    public static boolean showsPriceLine(boolean redacted, boolean noPrice, int pointCount) {
        return !redacted && !noPrice && pointCount >= 2;
    }
}
