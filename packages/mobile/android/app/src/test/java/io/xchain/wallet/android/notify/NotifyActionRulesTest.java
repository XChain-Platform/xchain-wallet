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

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class NotifyActionRulesTest {

    @Test
    public void exposesTheActivityIntentContract() {
        assertEquals("openOnPhone", NotifyActionRules.ACTION_OPEN_ON_PHONE);
        assertEquals("xc_notify_action", NotifyActionRules.EXTRA_ACTION);
        assertEquals("xc_notify_category", NotifyActionRules.EXTRA_CATEGORY);
        assertEquals("xc_notify_id", NotifyActionRules.EXTRA_ID);
    }

    @Test
    public void returnsStoredTitleForRequestCategories() {
        assertEquals("Open request", NotifyActionRules.openOnPhoneTitle("request", "Open request"));
        assertEquals("Pay now", NotifyActionRules.openOnPhoneTitle("paydue", "Pay now"));
    }

    @Test
    public void omitsTitleForOtherCategories() {
        assertNull(NotifyActionRules.openOnPhoneTitle("alert", "Open alert"));
        assertNull(NotifyActionRules.openOnPhoneTitle("txConfirmations", "Open transaction"));
        assertNull(NotifyActionRules.openOnPhoneTitle(null, "Open request"));
    }

    @Test
    public void omitsMissingOrBlankTitles() {
        assertNull(NotifyActionRules.openOnPhoneTitle("request", null));
        assertNull(NotifyActionRules.openOnPhoneTitle("request", ""));
        assertNull(NotifyActionRules.openOnPhoneTitle("paydue", " \t\n "));
    }

    @Test
    public void trimsStoredTitle() {
        assertEquals("Open on phone", NotifyActionRules.openOnPhoneTitle("request", "  Open on phone \t"));
    }

    @Test
    public void acceptsOpenOnPhoneForRequestCategories() {
        assertTrue(NotifyActionRules.isOpenOnPhone("openOnPhone", "request", "request-1"));
        assertTrue(NotifyActionRules.isOpenOnPhone("openOnPhone", "paydue", "payment-1"));
    }

    @Test
    public void refusesOtherActionsAndCategories() {
        assertFalse(NotifyActionRules.isOpenOnPhone("dismiss", "request", "request-1"));
        assertFalse(NotifyActionRules.isOpenOnPhone("openOnPhone", "alert", "alert-1"));
        assertFalse(NotifyActionRules.isOpenOnPhone("openOnPhone", "txConfirmations", "tx-1"));
        assertFalse(NotifyActionRules.isOpenOnPhone(null, "request", "request-1"));
        assertFalse(NotifyActionRules.isOpenOnPhone("openOnPhone", null, "request-1"));
    }

    @Test
    public void refusesMissingIds() {
        assertFalse(NotifyActionRules.isOpenOnPhone("openOnPhone", "request", null));
        assertFalse(NotifyActionRules.isOpenOnPhone("openOnPhone", "request", ""));
    }
}
