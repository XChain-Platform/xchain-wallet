// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import io.xchain.wallet.android.wear.data.WatchDisplayRules;
import io.xchain.wallet.android.wear.ui.BalancesHeadRules;
import io.xchain.wallet.android.wear.ui.BalancesHeadRules.Control;
import io.xchain.wallet.android.wear.ui.BalancesLayout;
import io.xchain.wallet.android.wear.ui.BalancesLayout.Item;
import io.xchain.wallet.android.wear.ui.BalancesLayout.Kind;

import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public final class BalancesHeadRulesCheck {
    private static final Set<String> ROUTES = new HashSet<>(Arrays.asList(
            "balances",
            "tokenDetail",
            "alerts",
            "alertDetail",
            "receive",
            "status",
            "notSetUp"));

    private static int checkCount;

    private BalancesHeadRulesCheck() {}

    public static void main(String[] args) {
        try {
            runChecks();
            System.out.println("BalancesHeadRulesCheck: " + checkCount + " checks passed");
        } catch (Throwable failure) {
            System.err.println("BalancesHeadRulesCheck failed: " + failure.getMessage());
            System.exit(1);
        }
    }

    private static void runChecks() {
        List<Control> controls = BalancesHeadRules.controls();
        check(controls.equals(Arrays.asList(Control.BELL, Control.QR, Control.STATUS)),
                "controls and order");
        checkRoute("alerts", controls.get(0).route(), "bell route");
        checkRoute("receive", controls.get(1).route(), "QR route");
        checkRoute("status", controls.get(2).route(), "status route");
        try {
            controls.add(Control.BELL);
            fail("controls list refuses add");
        } catch (UnsupportedOperationException expected) {
            check(true, "controls list refuses add");
        }

        List<Item> items = BalancesLayout.items(3, true, true);
        check(items.size() == 5, "fixture has request, three rows and more item");
        for (Item item : items) {
            switch (item.getKind()) {
                case REQUEST:
                    checkRoute("alertDetail", BalancesHeadRules.destinationRoute(item),
                            "request destination");
                    break;
                case ROW:
                    checkRoute("tokenDetail", BalancesHeadRules.destinationRoute(item),
                            "row " + item.getIndex() + " destination");
                    break;
                case MORE_ON_PHONE:
                    check(BalancesHeadRules.destinationRoute(item) == null,
                            "more on phone has no destination");
                    break;
                default:
                    fail("unexpected fixture item " + item.getKind());
            }
        }

        Item empty = BalancesLayout.items(0, false, false).get(0);
        check(empty.getKind() == Kind.EMPTY, "empty fixture kind");
        check(BalancesHeadRules.destinationRoute(empty) == null,
                "empty item has no destination");
        try {
            BalancesHeadRules.destinationRoute(null);
            fail("null item throws");
        } catch (NullPointerException expected) {
            check(true, "null item throws");
        }

        check(!BalancesHeadRules.showsUnreadDot(-1), "negative unread count");
        check(!BalancesHeadRules.showsUnreadDot(0), "zero unread count");
        check(BalancesHeadRules.showsUnreadDot(1), "one unread item");
        check(BalancesHeadRules.showsUnreadDot(12), "twelve unread items");

        check(BalancesHeadRules.headerTap(WatchDisplayRules.UnitsMode.FIAT, false)
                        == WatchDisplayRules.UnitsMode.UNITS,
                "fiat header tap off test network");
        check(BalancesHeadRules.headerTap(WatchDisplayRules.UnitsMode.UNITS, false)
                        == WatchDisplayRules.UnitsMode.FIAT,
                "units header tap off test network");
        check(BalancesHeadRules.headerTap(WatchDisplayRules.UnitsMode.FIAT, true) == null,
                "fiat header tap on test network");
        check(BalancesHeadRules.headerTap(WatchDisplayRules.UnitsMode.UNITS, true) == null,
                "units header tap on test network");
    }

    private static void checkRoute(String expected, String actual, String caseName) {
        check(expected.equals(actual), caseName);
        check(ROUTES.contains(actual), caseName + " is an allowed route");
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
