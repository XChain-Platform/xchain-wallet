// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// useLastView (§24 / G055): wraps the per-wallet last-view memory in
// the React lifecycle hooks each shell needs:
//
//   1. On the first render that sees a wallet id, read the persisted
//      view (if any) and hand it to the shell via `onResume(view)`.
//      Subsequent wallet-id changes also fire `onResume`. The user
//      switched wallets, the previous view does not necessarily map.
//   2. On every change to `currentView`, write it back to storage so
//      a later unlock returns to the same place.
//
// The shell's setView call site stays exactly as it was. No need to
// thread the helper into every navigation. The hook listens to view
// changes via the prop and persists in an effect.
//
// Cluster U FOLLOWUP 6: multi-wallet last-view threading. The persist
// effect now skips writes whenever the walletId has just changed but
// the current view is still the previous wallet's nav state. Without
// this guard, switching from wallet A (on /history) to wallet B
// would persist B -> 'history' before B's resume effect could fire,
// stomping any saved state for B.

import { useEffect, useRef } from 'react';
import { readLastView, writeLastView } from '../utils/lastViewMemory.js';

/**
 * @param {object} args
 * @param {string | null | undefined} args.walletId   Active wallet id.
 * @param {string} args.currentView                   The shell's current `unlockedView`.
 * @param {(view: string) => void} args.onResume      Called once per walletId change with the persisted view (or 'home' on miss).
 * @param {boolean} [args.skip]   §24.6 / Cluster Y FU 4: when true, the resume effect is
 *                                suppressed; a freshly-detached desktop window opens on its
 *                                pinned target rather than the user's last resumed view.
 *                                The persist effect still runs so navigation inside the
 *                                detached window survives a refresh.
 */
export function useLastView({ walletId, currentView, onResume, skip = false }) {
    const lastResumedFor = useRef(/** @type {string | null} */ (null));
    const lastPersistedFor = useRef(/** @type {string | null} */ (null));

    // Persist current view whenever it changes, but only after the
    // resume effect has run for this walletId. Without that gate, a
    // wallet switch (where `walletId` flips before `currentView`
    // catches up) writes the stale view under the new wallet's key.
    useEffect(() => {
        if (typeof walletId !== 'string' || !walletId) return;
        if (lastResumedFor.current !== walletId) {
            // Resume effect hasn't fired for this walletId yet. Wait.
            // The resume effect runs in the next pass and bumps
            // `lastResumedFor`; subsequent currentView changes then
            // persist correctly.
            return;
        }
        if (lastPersistedFor.current !== walletId) {
            // First persist for this walletId after a switch. Skip
            // exactly one tick so the resume's setUnlockedView
            // (called via onResume) propagates into currentView before
            // we write anything. The very next render with
            // currentView matching the resumed value persists normally.
            lastPersistedFor.current = walletId;
            return;
        }
        writeLastView(walletId, currentView);
    }, [walletId, currentView]);

    // Resume on wallet activation / change. Skips re-running for the
    // same walletId so user navigation after the resume is not
    // overwritten by a stale read. `skip` short-circuits the resume
    // entirely (detached-window case) but still bumps `lastResumedFor`
    // so the persist gate can advance. Otherwise the persist effect
    // would refuse to write any nav state from the detached window.
    useEffect(() => {
        if (typeof walletId !== 'string' || !walletId) {
            lastResumedFor.current = null;
            lastPersistedFor.current = null;
            return;
        }
        if (lastResumedFor.current === walletId) return;
        lastResumedFor.current = walletId;
        lastPersistedFor.current = null;
        if (skip) return;
        const persisted = readLastView(walletId);
        if (persisted && persisted !== currentView) {
            onResume(persisted);
        }
    // currentView + skip intentionally omitted. We only resume on
    // walletId change. skip is captured at the moment the resume would
    // fire; flipping skip later does not retroactively trigger the
    // resume.
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
    }, [walletId]);
}
