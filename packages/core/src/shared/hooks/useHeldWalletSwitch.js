// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A wallet chosen in another window or surface while this one runs a review,
// or shows the signing or broadcast result a review ended on, waits here. The
// review signs for the wallet it shows, and its result names that wallet, so
// neither may change under the user. The switch applies as soon as the review
// ends without an approval (the user is back on the form), or when the user
// leaves the result. A wallet removed meanwhile drops the waiting switch.

import { useCallback, useEffect, useRef } from 'react';
import { isConfirmActive, subscribeConfirmEnd } from './useConfirmAction.js';

/**
 * @param {(walletId: string, how: { navigated: boolean }) => void} apply
 *   switch this window to the wallet; `navigated` is true when the user is
 *   already on the way to a new screen, so the shell keeps that destination
 * @returns {{
 *   request: (walletId: string) => boolean,
 *   drop: (walletId: string) => void,
 *   navigated: () => void,
 *   clear: () => void,
 * }}
 *   `request` holds the switch and returns true while a review or its result
 *   is open, and returns false when the shell may switch at once; `drop`
 *   forgets a held switch to a removed wallet; `navigated` is called on every
 *   navigation; `clear` forgets everything, for a lock.
 */
export function useHeldWalletSwitch(apply) {
    const pending = useRef(/** @type {string | null} */ (null));
    const resultOpen = useRef(false);
    const applyRef = useRef(apply);
    applyRef.current = apply;

    const release = useCallback((navigated) => {
        resultOpen.current = false;
        const walletId = pending.current;
        if (!walletId) return;
        pending.current = null;
        applyRef.current(walletId, { navigated });
    }, []);

    useEffect(() => subscribeConfirmEnd(({ approved, left }) => {
        if (approved) {
            resultOpen.current = true;
            return;
        }
        // A form unmounted mid-review is a navigation; the shell's navigation
        // call applies the switch without overriding where the user went.
        if (!left) release(false);
    }), [release]);

    const request = useCallback((walletId) => {
        if (isConfirmActive() || resultOpen.current) {
            pending.current = walletId;
            return true;
        }
        pending.current = null;
        return false;
    }, []);

    const drop = useCallback((walletId) => {
        if (pending.current === walletId) pending.current = null;
    }, []);

    const navigated = useCallback(() => {
        if (!isConfirmActive()) release(true);
    }, [release]);

    const clear = useCallback(() => {
        pending.current = null;
        resultOpen.current = false;
    }, []);

    return { request, drop, navigated, clear };
}
