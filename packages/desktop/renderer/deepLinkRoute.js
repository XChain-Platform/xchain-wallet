// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The one URI to view mapping for `xchain:` links, shared by the desktop
// shell and the web/native shell so the two cannot drift: turn the raw URI main handed over
// into the form it prefills. A link is attacker-controlled input, so the
// only thing it can ever do is land the user on a prefilled form they still
// have to act on: nothing here unlocks, signs or submits.

import { useEffect, useState } from 'react';
import { uri as coreUri } from '@xchain-wallet/core';

/**
 * Map an OS-delivered `xchain:` link to the form it prefills, or null when it
 * names nothing this shell routes. Re-parsed from `raw` with the renderer's
 * registry so coin-code links resolve a chainId, and hardened before any of
 * it becomes state.
 *
 * @param {unknown} raw
 * @param {any} chainRegistry
 * @returns {{ view: 'send' | 'receive' | 'contract-execute', sendPrefill?: { address?: string, amount?: string, tick?: string, chainId?: string, memo?: string }, contractRef?: { chainId: string, contractActionIndex: string }, executePrefill?: { method: string, paramsText: string } } | null}
 */
export function deepLinkRoute(raw, chainRegistry) {
    if (typeof raw !== 'string' || !raw) return null;
    let intent;
    try {
        intent = coreUri.hardenUriIntentText(coreUri.parseXchainUri(raw, { chainRegistry }));
    } catch {
        return null;
    }
    if (intent?.kind === 'send') {
        return {
            view: 'send',
            sendPrefill: {
                address: intent.address,
                amount: intent.amount,
                tick: intent.tick,
                chainId: intent.chainId,
                memo: intent.memo,
            },
        };
    }
    if (intent?.kind === 'receive') return { view: 'receive' };
    // Route an execute link only with a contract index and a resolved chain
    if (intent?.kind === 'execute' && intent.contractActionIndex && intent.chainId) {
        return {
            view: 'contract-execute',
            contractRef: { chainId: intent.chainId, contractActionIndex: intent.contractActionIndex },
            executePrefill: {
                method: intent.method || '',
                paramsText: intent.executeParams || '',
            },
        };
    }
    return null;
}

/**
 * Claim parked links from main: once now, then again on every nudge. Only what
 * takePending returns is routed, so each link lands in at most one window. A
 * detached window claims nothing; it keeps the view it was opened on.
 *
 * @param {{ bridge?: { takePending: () => Promise<any>, onUri: (fn: () => void) => () => void }, detached: boolean, chainRegistry: any, onRoute: (route: NonNullable<ReturnType<typeof deepLinkRoute>>) => void }} opts
 * @returns {() => void} unsubscribe
 */
export function watchDeepLinks({ bridge, detached, chainRegistry, onRoute }) {
    if (!bridge || detached) return () => {};
    let live = true;
    const claim = () => {
        Promise.resolve()
            .then(() => bridge.takePending())
            .then((event) => {
                const route = live ? deepLinkRoute(event?.raw, chainRegistry) : null;
                if (route) onRoute(route);
            })
            .catch(() => { /* a failed claim is dropped; the next nudge claims again */ });
    };
    claim();
    const off = bridge.onUri(claim);
    return () => { live = false; off(); };
}

/**
 * Desktop deep-link intake: claim on mount, hold the route while locked, and
 * hand it to apply once a wallet is unlocked. Call it after the last-view
 * resume so the link's form is the view that sticks.
 *
 * @param {{ bridge?: any, detached: boolean, chainRegistry: any, unlocked: boolean, walletId: string | null | undefined, apply: (route: NonNullable<ReturnType<typeof deepLinkRoute>>) => void }} opts
 */
export function useDeepLinks({ bridge, detached, chainRegistry, unlocked, walletId, apply }) {
    const [route, setRoute] = useState(/** @type {ReturnType<typeof deepLinkRoute>} */ (null));
    // Mount-only: the bridge and the detached flag are fixed for a window's life
    useEffect(() => watchDeepLinks({ bridge, detached, chainRegistry, onRoute: setRoute }), []);
    useEffect(() => {
        if (!route || detached || !unlocked || !walletId) return;
        apply(route);
        setRoute(null);
    }, [route, unlocked, walletId]);
}
