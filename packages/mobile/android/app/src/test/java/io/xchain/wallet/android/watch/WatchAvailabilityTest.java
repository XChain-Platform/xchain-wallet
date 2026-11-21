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

package io.xchain.wallet.android.watch;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class WatchAvailabilityTest {

    @Test
    public void acceptsOnlyPlayInstallers() {
        assertTrue(WatchAvailability.isPlayInstaller("com.android.vending"));
        assertTrue(WatchAvailability.isPlayInstaller("com.google.android.feedback"));
        assertFalse(WatchAvailability.isPlayInstaller("com.amazon.venezia"));
        assertFalse(WatchAvailability.isPlayInstaller("com.sec.android.app.samsungapps"));
        assertFalse(WatchAvailability.isPlayInstaller("com.huawei.appmarket"));
        assertFalse(WatchAvailability.isPlayInstaller("com.example.store"));
        assertFalse(WatchAvailability.isPlayInstaller(""));
        assertFalse(WatchAvailability.isPlayInstaller(null));
        assertFalse(WatchAvailability.isPlayInstaller("COM.ANDROID.VENDING"));
    }

    @Test
    public void allowsWatchForDebuggableOrPlayInstalls() {
        assertTrue(WatchAvailability.watchAllowed("com.android.vending", true));
        assertTrue(WatchAvailability.watchAllowed("com.android.vending", false));
        assertTrue(WatchAvailability.watchAllowed("com.example.store", true));
        assertFalse(WatchAvailability.watchAllowed("com.example.store", false));
    }
}
