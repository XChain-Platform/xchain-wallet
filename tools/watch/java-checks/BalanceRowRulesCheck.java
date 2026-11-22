// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import io.xchain.wallet.android.wear.ui.BalanceRowRules;

public final class BalanceRowRulesCheck {
    private BalanceRowRulesCheck() {}

    private static void require(boolean condition, String caseName) {
        if (!condition) {
            System.err.println(caseName);
            System.exit(1);
        }
    }

    private static void requireEqual(String expected, String actual, String caseName) {
        require(expected == null ? actual == null : expected.equals(actual), caseName);
    }

    public static void main(String[] args) {
        require(BalanceRowRules.stacksNameOverAmount(192), "stacksNameOverAmount at 192 dp");
        require(BalanceRowRules.stacksNameOverAmount(224), "stacksNameOverAmount at 224 dp");
        require(!BalanceRowRules.stacksNameOverAmount(225), "stacksNameOverAmount at 225 dp");
        require(!BalanceRowRules.stacksNameOverAmount(227), "stacksNameOverAmount at 227 dp");

        String amount = "1.25 XCH";
        String fiat = "$3.50";

        requireEqual(amount, BalanceRowRules.amountPrimary(false, amount, fiat),
                "units mode primary");
        requireEqual(null, BalanceRowRules.amountSecondary(false, amount, false),
                "units mode secondary");
        requireEqual(fiat, BalanceRowRules.amountPrimary(true, amount, fiat),
                "fiat priced primary");
        requireEqual(null, BalanceRowRules.amountSecondary(true, amount, false),
                "fiat priced secondary");
        requireEqual("No price yet", BalanceRowRules.amountPrimary(true, amount, "No price yet"),
                "fiat no price primary");
        requireEqual(amount, BalanceRowRules.amountSecondary(true, amount, true),
                "fiat no price secondary");
        requireEqual(null, BalanceRowRules.amountSecondary(false, amount, true),
                "units mode no price secondary");
    }
}
