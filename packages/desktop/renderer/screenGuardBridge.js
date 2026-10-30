// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Connects core's route-scoped screen guard (§1, S4) to this window's
// content protection: a screen that shows a recovery phrase or a private key
// turns it on as it mounts and off as it unmounts, whether it leaves by
// navigation, a lock or an error. Main applies it to the sending window only
// (main/screenProtection.js).

import { installScreenGuard } from '@xchain-wallet/core/shared/utils/screenGuard.js';

export const WINDOW_HIDDEN_EVENT = 'xc:window-hidden';

/**
 * Install the desktop screen guard when the preload offers it.
 *
 * @param {any} [env]
 * @returns {boolean} whether the guard was installed
 */
export function installDesktopScreenGuard(env = globalThis) {
    const bridge = env?.xchainWalletWindow;
    if (typeof bridge?.setScreenProtected !== 'function') return false;
    const send = (protectedNow) => {
        // Runs inside a React effect and its cleanup: a rejected call must not
        // surface as an unhandled rejection in the middle of a backup.
        Promise.resolve()
            .then(() => bridge.setScreenProtected(protectedNow))
            .catch(() => { /* the screen stays usable without protection */ });
    };
    // A reload or a renderer crash on a key screen never runs that screen's
    // release, so the window keeps its protection. Boot releases it before
    // any screen mounts; a key screen that mounts next turns it back on.
    send(false);
    installScreenGuard(send);
    return true;
}

/**
 * Forward native window hiding into the renderer event used by secret screens.
 *
 * @param {any} [env]
 * @returns {boolean} whether the notice bridge was installed
 */
export function installDesktopSecretHideNotice(env = globalThis) {
    const bridge = env?.xchainWalletWindow;
    if (typeof bridge?.onHidden !== 'function' || typeof env?.dispatchEvent !== 'function') {
        return false;
    }
    bridge.onHidden(() => {
        const EventType = env.CustomEvent ?? globalThis.CustomEvent;
        env.dispatchEvent(new EventType(WINDOW_HIDDEN_EVENT));
    });
    return true;
}
