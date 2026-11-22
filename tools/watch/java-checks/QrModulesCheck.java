// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import io.xchain.wallet.android.wear.ui.QrModules;

import java.util.Arrays;

public final class QrModulesCheck {
    private QrModulesCheck() {}

    public static void main(String[] arguments) {
        checkModules(
                "size 3 vector",
                QrModules.unpack(3, "qoA="),
                true, false, true,
                false, true, false,
                true, false, true);
        checkModules(
                "size 4 vector",
                QrModules.unpack(4, "8JY="),
                true, true, true, true,
                false, false, false, false,
                true, false, false, true,
                false, true, true, false);
        checkNull("malformed base64", QrModules.unpack(3, "@@@@"));
        checkNull("null text", QrModules.unpack(3, null));
        checkNull("short byte count", QrModules.unpack(5, "qoA="));
        checkNull("long byte count", QrModules.unpack(3, "qoCA"));
        checkNull("zero size", QrModules.unpack(0, ""));
        checkNull("negative size", QrModules.unpack(-1, ""));
    }

    private static void checkModules(String name, boolean[] actual, boolean... expected) {
        if (!Arrays.equals(actual, expected)) fail(name);
    }

    private static void checkNull(String name, boolean[] actual) {
        if (actual != null) fail(name);
    }

    private static void fail(String name) {
        System.err.println("QrModulesCheck failed: " + name);
        System.exit(1);
    }
}
