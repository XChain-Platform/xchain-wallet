// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear.ui;

import io.xchain.wallet.android.wear.data.WatchDisplayRules;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Objects;

public final class BalancesHeadRules {
    public enum Control {
        BELL("alerts"),
        QR("receive"),
        STATUS("status");

        private final String route;

        Control(String route) {
            this.route = route;
        }

        public String route() {
            return route;
        }
    }

    private static final List<Control> CONTROLS = Collections.unmodifiableList(Arrays.asList(
            Control.BELL,
            Control.QR,
            Control.STATUS));

    private BalancesHeadRules() {}

    public static List<Control> controls() {
        return CONTROLS;
    }

    public static String destinationRoute(BalancesLayout.Item item) {
        switch (Objects.requireNonNull(item, "item").getKind()) {
            case ROW:
                return "tokenDetail";
            case REQUEST:
                return "alertDetail";
            case MORE_ON_PHONE:
            case EMPTY:
                return null;
            default:
                throw new AssertionError(item.getKind());
        }
    }

    public static boolean showsUnreadDot(int unread) {
        return unread > 0;
    }

    public static WatchDisplayRules.UnitsMode headerTap(
            WatchDisplayRules.UnitsMode mode, boolean isTest) {
        return isTest ? null : WatchDisplayRules.toggled(mode, false);
    }
}
