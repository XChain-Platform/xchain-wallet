/*
 * Copyright © 2025–2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC - https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available -
 * contact legal@dankest.llc.
 */

package io.xchain.wallet.android.links;

import java.util.function.Predicate;

public final class BrowserReturnTarget {

    private static final String ANDROID_APP_PREFIX = "android-app://";

    private BrowserReturnTarget() {}

    public static String packageFromReferrer(String referrerUri) {
        if (referrerUri == null || !referrerUri.startsWith(ANDROID_APP_PREFIX)) return null;

        String packageName = referrerUri.substring(ANDROID_APP_PREFIX.length());
        if (packageName.isEmpty()
                || packageName.indexOf('/') >= 0
                || packageName.indexOf('?') >= 0
                || packageName.indexOf('#') >= 0) {
            return null;
        }
        return packageName;
    }

    public static String chooseBrowserPackage(
            String referrerUri,
            String ownPackage,
            Predicate<String> resolvesGenericHttps) {
        String referrerPackage = packageFromReferrer(referrerUri);
        if (referrerPackage == null
                || referrerPackage.equals(ownPackage)
                || resolvesGenericHttps == null
                || !resolvesGenericHttps.test(referrerPackage)) {
            return null;
        }
        return referrerPackage;
    }
}
