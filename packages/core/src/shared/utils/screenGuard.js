// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Screenshot protection for the screens that show key material
// ( §1, stage S4).
//
// ROUTE-SCOPED, NOT APP-WIDE, and the scoping is the whole design. On a
// mobile shell this drives Android's FLAG_SECURE, which does two things:
// it blocks screenshots and screen recording, and it keeps the window out
// of the recents thumbnail - which Android persists to DISK. A seed phrase
// sitting in a recents snapshot is a seed phrase on the flash of a device
// that gets sold, stolen, or repaired.
//
// So it goes on for: the recovery phrase, private-key export, mnemonic
// entry, and the unlock screen. It stays OFF everywhere else, because:
//
//   - screenshotting your own receive address QR is ordinary wallet use,
//     and users do it constantly;
//   - an app-wide flag also blanks the screen in a screen-share, so a user
//     trying to get help would find their support call showing black.
//
// Core owns the POLICY (which screens) and knows nothing about how the
// protection is applied. A shell installs a handler; every other shell -
// web, extension, desktop - installs none and every call here is a no-op,
// which is correct: a browser tab cannot stop a screenshot, and pretending
// otherwise in the UI would be worse than not trying.

import { useEffect } from 'react';

/** @type {((protectedNow: boolean) => void) | null} */
let handler = null;

/** Depth counter: nested protected screens must not unprotect each other. */
let depth = 0;

/**
 * Install the shell's implementation. Called once at boot by a shell that
 * has one; every other shell leaves this alone.
 *
 * @param {((protectedNow: boolean) => void) | null} fn
 */
export function installScreenGuard(fn) {
    handler = typeof fn === 'function' ? fn : null;
    // Re-assert on install: a shell that installs its handler after a
    // protected screen has already mounted (the boot path is async on
    // mobile) would otherwise leave that screen unprotected until the next
    // navigation.
    if (handler && depth > 0) safely(true);
}

/** @returns {boolean} whether a shell is actually applying protection. */
export function isScreenGuardActive() {
    return handler !== null;
}

/**
 * Protect while this component is mounted.
 *
 * Reference-counted rather than a plain on/off, because these screens do
 * nest: a modal revealing a private key can open over a settings page that
 * already asked for protection, and the modal closing must not clear the
 * flag the page underneath still needs.
 *
 * @param {boolean} [enabled]  pass false to opt out conditionally
 */
export function useProtectedScreen(enabled = true) {
    useEffect(() => {
        if (!enabled) return undefined;
        depth += 1;
        if (depth === 1) safely(true);
        return () => {
            depth = Math.max(0, depth - 1);
            if (depth === 0) safely(false);
        };
    }, [enabled]);
}

/** Test seam: forget any installed handler and reset the counter. */
export function __resetScreenGuardForTests() {
    handler = null;
    depth = 0;
}

function safely(protectedNow) {
    try {
        handler?.(protectedNow);
    } catch (_err) {
        // A failing guard must never take down the screen it protects. The
        // user is mid-backup or mid-unlock; a thrown error here would lose
        // them the flow entirely, which is a worse outcome than a screenshot
        // being possible on a device where the call did not work.
    }
}
