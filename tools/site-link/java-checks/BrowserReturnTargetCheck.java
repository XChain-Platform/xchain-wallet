// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import io.xchain.wallet.android.links.BrowserReturnTarget;

public final class BrowserReturnTargetCheck {

    private static final String BROWSER_PACKAGE = "com.example.browser";
    private static final String WALLET_PACKAGE = "io.xchain.wallet";

    private BrowserReturnTargetCheck() {}

    public static void main(String[] args) {
        check(
                "valid browser referrer",
                BROWSER_PACKAGE.equals(BrowserReturnTarget.chooseBrowserPackage(
                        "android-app://" + BROWSER_PACKAGE,
                        WALLET_PACKAGE,
                        BROWSER_PACKAGE::equals)));
        check(
                "forged non-browser package",
                BrowserReturnTarget.chooseBrowserPackage(
                        "android-app://com.example.forged",
                        WALLET_PACKAGE,
                        BROWSER_PACKAGE::equals) == null);
        check(
                "wallet own package",
                BrowserReturnTarget.chooseBrowserPackage(
                        "android-app://" + WALLET_PACKAGE,
                        WALLET_PACKAGE,
                        packageName -> true) == null);
        check(
                "wrong scheme",
                BrowserReturnTarget.chooseBrowserPackage(
                        "https://" + BROWSER_PACKAGE,
                        WALLET_PACKAGE,
                        packageName -> true) == null);
        check(
                "null referrer",
                BrowserReturnTarget.chooseBrowserPackage(
                        null,
                        WALLET_PACKAGE,
                        packageName -> true) == null);
        check(
                "empty referrer",
                BrowserReturnTarget.chooseBrowserPackage(
                        "",
                        WALLET_PACKAGE,
                        packageName -> true) == null);
        check(
                "empty referrer package",
                BrowserReturnTarget.packageFromReferrer("android-app://") == null);
    }

    private static void check(String name, boolean passed) {
        if (passed) return;
        System.err.println("FAILED: " + name);
        System.exit(1);
    }
}
