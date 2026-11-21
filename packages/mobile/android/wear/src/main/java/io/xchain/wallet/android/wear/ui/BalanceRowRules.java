// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear.ui;

public final class BalanceRowRules {
    public static final int SMALL_ROUND_MAX_DP = 225;

    private BalanceRowRules() {}

    public static boolean stacksNameOverAmount(int screenWidthDp) {
        return screenWidthDp < SMALL_ROUND_MAX_DP;
    }

    public static String amountPrimary(boolean fiatMode, String amountText, String fiatText) {
        return fiatMode ? fiatText : amountText;
    }

    public static String amountSecondary(boolean fiatMode, String amountText, boolean noPrice) {
        return fiatMode && noPrice ? amountText : null;
    }
}
