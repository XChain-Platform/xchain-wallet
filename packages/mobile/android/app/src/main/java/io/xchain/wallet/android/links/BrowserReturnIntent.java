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

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;

public final class BrowserReturnIntent {

    private BrowserReturnIntent() {}

    static boolean resolvesGenericHttps(PackageManager pm, String packageName) {
        if (pm == null || packageName == null || packageName.isEmpty()) return false;

        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com/"))
                .addCategory(Intent.CATEGORY_BROWSABLE)
                .setPackage(packageName);
        try {
            return !pm.queryIntentActivities(intent, 0).isEmpty();
        } catch (Exception exception) {
            return false;
        }
    }

    static Intent forUrl(
            String checkedUrl, String referrerUri, String ownPackage, PackageManager pm) {
        if (checkedUrl == null || checkedUrl.isEmpty()) return null;

        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(checkedUrl))
                .addCategory(Intent.CATEGORY_BROWSABLE)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        String packageName = BrowserReturnTarget.chooseBrowserPackage(
                referrerUri, ownPackage, candidate -> resolvesGenericHttps(pm, candidate));
        if (packageName != null) intent.setPackage(packageName);
        return intent;
    }
}
