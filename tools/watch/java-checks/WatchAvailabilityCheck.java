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

import io.xchain.wallet.android.watch.WatchAvailability;

public final class WatchAvailabilityCheck {

    private static void expect(String name, boolean actual, boolean expected) {
        if (actual != expected) {
            System.err.println("FAIL: " + name + " expected " + expected + " got " + actual);
            System.exit(1);
        }
    }

    public static void main(String[] args) {
        String[] play = {"com.android.vending", "com.google.android.feedback"};
        String[] other = {null, "", "com.amazon.venezia"};

        for (String installer : play) {
            expect("play " + installer + " ready", WatchAvailability.startsMessageRouter(installer, false, true), true);
            expect("play " + installer + " not ready", WatchAvailability.startsMessageRouter(installer, false, false), false);
            expect("isPlayInstaller " + installer, WatchAvailability.isPlayInstaller(installer), true);
            expect("watchAllowed " + installer, WatchAvailability.watchAllowed(installer, false), true);
        }
        for (String installer : other) {
            expect("non-play " + installer + " ready", WatchAvailability.startsMessageRouter(installer, false, true), false);
            expect("non-play " + installer + " not ready", WatchAvailability.startsMessageRouter(installer, false, false), false);
            expect("isPlayInstaller " + installer, WatchAvailability.isPlayInstaller(installer), false);
            expect("watchAllowed " + installer, WatchAvailability.watchAllowed(installer, false), false);
        }
        String[] all = {"com.android.vending", "com.google.android.feedback", null, "", "com.amazon.venezia"};
        for (String installer : all) {
            expect("debuggable " + installer + " ready", WatchAvailability.startsMessageRouter(installer, true, true), true);
            expect("debuggable " + installer + " not ready", WatchAvailability.startsMessageRouter(installer, true, false), false);
            expect("watchAllowed debuggable " + installer, WatchAvailability.watchAllowed(installer, true), true);
        }
        System.out.println("WatchAvailabilityCheck ok");
    }
}
