// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear.ui;

import java.util.Locale;
import java.util.regex.Pattern;

public final class TokenGlyph {
    private static final Pattern RGB_HEX = Pattern.compile("^#[0-9A-F]{6}$");

    private TokenGlyph() {}

    public static String letter(String tick) {
        if (tick == null || tick.isEmpty()) {
            return "?";
        }
        return tick.substring(0, 1).toUpperCase(Locale.ROOT);
    }

    public static double[] rgb(String hex) {
        if (hex == null || !RGB_HEX.matcher(hex).matches()) {
            return null;
        }
        return new double[] {
            Integer.parseInt(hex.substring(1, 3), 16) / 255.0,
            Integer.parseInt(hex.substring(3, 5), 16) / 255.0,
            Integer.parseInt(hex.substring(5, 7), 16) / 255.0,
        };
    }
}
