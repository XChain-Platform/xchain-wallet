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

package io.xchain.wallet.android.notify;

/** Rules shared by notification action creation and activity intent intake. */
public final class NotifyActionRules {

    public static final String ACTION_OPEN_ON_PHONE = "openOnPhone";
    public static final String EXTRA_ACTION = "xc_notify_action";
    public static final String EXTRA_CATEGORY = "xc_notify_category";
    public static final String EXTRA_ID = "xc_notify_id";

    private static final String CATEGORY_REQUEST = "request";
    private static final String CATEGORY_PAYDUE = "paydue";

    private NotifyActionRules() {}

    public static String openOnPhoneTitle(String category, String storedTitle) {
        if (!isOpenOnPhoneCategory(category) || storedTitle == null) {
            return null;
        }
        String title = storedTitle.trim();
        return title.isEmpty() ? null : title;
    }

    public static boolean isOpenOnPhone(String action, String category, String id) {
        return ACTION_OPEN_ON_PHONE.equals(action)
                && isOpenOnPhoneCategory(category)
                && id != null
                && !id.isEmpty();
    }

    private static boolean isOpenOnPhoneCategory(String category) {
        return CATEGORY_REQUEST.equals(category) || CATEGORY_PAYDUE.equals(category);
    }
}
