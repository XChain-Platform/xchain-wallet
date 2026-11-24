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

public final class BrowserReturnUrl {

    private static final int AUTHORITY_START = 8;

    private BrowserReturnUrl() {}

    public static String checked(String url) {
        if (url == null || !url.regionMatches(true, 0, "https://", 0, AUTHORITY_START)) {
            return null;
        }

        int authorityEnd = url.length();
        for (int index = 0; index < url.length(); index++) {
            char character = url.charAt(index);
            if (character <= ' ' || character == 0x7f) return null;
            if (index >= AUTHORITY_START
                    && authorityEnd == url.length()
                    && (character == '/' || character == '?' || character == '#')) {
                authorityEnd = index;
            }
        }

        String authority = url.substring(AUTHORITY_START, authorityEnd);
        if (authority.isEmpty() || authority.indexOf('@') >= 0 || authority.charAt(0) == ':') {
            return null;
        }
        return url;
    }
}
