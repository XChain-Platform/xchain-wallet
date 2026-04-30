// useLastView — §24 / G055. Wraps the per-wallet last-view memory in
// the React lifecycle hooks each shell needs:
//
//   1. On the first render that sees a wallet id, read the persisted
//      view (if any) and hand it to the shell via `onResume(view)`.
//      Subsequent wallet-id changes also fire `onResume` — the user
//      switched wallets, the previous view does not necessarily map.
//   2. On every change to `currentView`, write it back to storage so
//      a later unlock returns to the same place.
//
// The shell's setView call site stays exactly as it was — no need to
// thread the helper into every navigation. The hook listens to view
// changes via the prop and persists in an effect.
//
// Cluster U FOLLOWUP 6 — multi-wallet last-view threading. The persist
// effect now skips writes whenever the walletId has just changed but
// the current view is still the previous wallet's nav state. Without
// this guard, switching from wallet A (on /history) to wallet B
// would persist B → 'history' before B's resume effect could fire,
// stomping any saved state for B.

import { useEffect, useRef } from 'react';
import { readLastView, writeLastView } from '../utils/lastViewMemory.js';

/**
 * @param {object} args
 * @param {string | null | undefined} args.walletId   Active wallet id.
 * @param {string} args.currentView                   The shell's current `unlockedView`.
 * @param {(view: string) => void} args.onResume      Called once per walletId change with the persisted view (or 'home' on miss).
 */
export function useLastView({ walletId, currentView, onResume }) {
    const lastResumedFor = useRef(/** @type {string | null} */ (null));
    const lastPersistedFor = useRef(/** @type {string | null} */ (null));

    // Persist current view whenever it changes — but only after the
    // resume effect has run for this walletId. Without that gate, a
    // wallet switch (where `walletId` flips before `currentView`
    // catches up) writes the stale view under the new wallet's key.
    useEffect(() => {
        if (typeof walletId !== 'string' || !walletId) return;
        if (lastResumedFor.current !== walletId) {
            // Resume effect hasn't fired for this walletId yet — wait.
            // The resume effect runs in the next pass and bumps
            // `lastResumedFor`; subsequent currentView changes then
            // persist correctly.
            return;
        }
        if (lastPersistedFor.current !== walletId) {
            // First persist for this walletId after a switch — skip
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
    // overwritten by a stale read.
    useEffect(() => {
        if (typeof walletId !== 'string' || !walletId) {
            lastResumedFor.current = null;
            lastPersistedFor.current = null;
            return;
        }
        if (lastResumedFor.current === walletId) return;
        lastResumedFor.current = walletId;
        // Clear the persist gate — the next persist effect run for
        // this walletId is the post-switch grace tick.
        lastPersistedFor.current = null;
        const persisted = readLastView(walletId);
        if (persisted && persisted !== currentView) {
            onResume(persisted);
        }
    // currentView intentionally omitted — we only resume on walletId
    // change, not every nav. onResume must be stable (useCallback in
    // the caller).
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
    }, [walletId]);
}
