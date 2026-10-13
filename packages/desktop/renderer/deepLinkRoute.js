// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The one external-link to view mapping, shared by the desktop, extension and
// web/native shells so they cannot drift: turn the raw URI a shell hands over
// into the form it prefills. A link is attacker-controlled input, so the
// only thing it can ever do is land the user on a prefilled form they still
// have to act on: nothing here unlocks, signs or submits.

import { useEffect, useState } from 'react';
import { uri as coreUri } from '@xchain-wallet/core';

const COIN_SCHEMES = Object.freeze({
    bitcoin: { coin: 'bitcoin', tick: 'BTC' },
    litecoin: { coin: 'litecoin', tick: 'LTC' },
    dogecoin: { coin: 'dogecoin', tick: 'DOGE' },
});

export const INVALID_DEEP_LINK_MESSAGE = 'This link is invalid or unsupported.';

function invalidRoute() {
    return { view: 'deep-link-error', message: INVALID_DEEP_LINK_MESSAGE };
}

function unwrapProtocolHandler(raw) {
    if (!raw.toLowerCase().startsWith('web+xchain:')) return raw;
    const carried = raw.slice('web+xchain:'.length);
    if (!carried) return '';
    const colon = carried.indexOf(':');
    const scheme = colon > 0 ? carried.slice(0, colon).toLowerCase() : '';
    return scheme === 'xchain' || COIN_SCHEMES[scheme] ? carried : `xchain:${carried}`;
}

/**
 * Map an externally delivered link to its prefilled form. Claimed links that
 * cannot be parsed return a plain-message route; unrelated input returns null.
 * The renderer registry resolves every accepted link to a chainId, and text is
 * hardened before any of it becomes state.
 *
 * @param {unknown} raw
 * @param {any} chainRegistry
 * @returns {{ view: 'send' | 'receive' | 'contract-execute', sendPrefill?: { address?: string, amount?: string, tick?: string, chainId?: string, memo?: string }, contractRef?: { chainId: string, contractActionIndex: string }, executePrefill?: { method: string, paramsText: string } } | { view: 'deep-link-error', message: string } | null}
 */
export function deepLinkRoute(raw, chainRegistry) {
    if (typeof raw !== 'string' || !raw) return null;
    const trimmed = raw.trim();
    const fromProtocolHandler = trimmed.toLowerCase().startsWith('web+xchain:');
    const normalized = unwrapProtocolHandler(trimmed);
    if (!normalized && fromProtocolHandler) return invalidRoute();
    const colon = normalized.indexOf(':');
    const scheme = colon > 0 ? normalized.slice(0, colon).toLowerCase() : '';
    const coinScheme = COIN_SCHEMES[scheme];

    if (coinScheme) {
        try {
            const parts = coreUri.parseBip21Uri(normalized);
            if (parts.required?.length > 0) return invalidRoute();
            const memo = parts.message ?? parts.label;
            const hardened = coreUri.hardenUriIntentText({ kind: 'send', memo });
            const chainId = chainRegistry?.chainIdFor?.(coinScheme.coin, 'mainnet') || undefined;
            if (!chainId) return invalidRoute();
            return {
                view: 'send',
                sendPrefill: {
                    address: parts.address,
                    amount: parts.amount,
                    tick: coinScheme.tick,
                    chainId,
                    memo: hardened.memo,
                },
            };
        } catch {
            return invalidRoute();
        }
    }

    const lower = normalized.toLowerCase();
    const isXchainLink = scheme === 'xchain'
        || lower.startsWith('https://xchain.io/wallet/link/');
    if (!isXchainLink) return null;
    let intent;
    try {
        intent = coreUri.hardenUriIntentText(coreUri.parseXchainUri(normalized, { chainRegistry }));
    } catch {
        return invalidRoute();
    }
    if (intent?.kind === 'send') {
        let amount = intent.amount;
        try {
            amount = coreUri.normalizeBip21Amount(amount);
        } catch {
            return invalidRoute();
        }
        return {
            view: 'send',
            sendPrefill: {
                address: intent.address,
                amount,
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
    return invalidRoute();
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
