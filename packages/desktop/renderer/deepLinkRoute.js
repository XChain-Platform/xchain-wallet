// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Desktop half of `xchain:` deep links: turn the raw URI main handed over
// into the form it prefills. A link is attacker-controlled input, so the
// only thing it can ever do is land the user on a prefilled form they still
// have to act on: nothing here unlocks, signs or submits.

import { uri as coreUri } from '@xchain-wallet/core';

/**
 * Map an OS-delivered `xchain:` link to the form it prefills, or null when it
 * names nothing this shell routes. Re-parsed from `raw` with the renderer's
 * registry so coin-code links resolve a chainId, and hardened before any of
 * it becomes state.
 *
 * @param {unknown} raw
 * @param {any} chainRegistry
 * @returns {{ view: 'send' | 'receive' | 'contract-execute', sendPrefill?: { address?: string, amount?: string, tick?: string, chainId?: string, memo?: string }, contractRef?: { chainId: string, contractActionIndex: string } } | null}
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
        };
    }
    return null;
}
