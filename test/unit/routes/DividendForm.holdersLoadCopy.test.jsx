// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Pins what the Dividend holder-count hint SAYS when the holder read fails.
// The stored error is already a whole read sentence, so the hint must show it
// as-is: wrapping it again doubled the opener on screen.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DividendForm } from '../../../packages/core/src/shared/routes/DividendForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const TICK = 'JDOG';
const ADDRESS = Object.freeze({
    id: 'addr-hd-0',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

/** An SDK explorer failure as it arrives after the messaging boundary. */
function explorerError(message) {
    const err = new Error(message);
    err.name = 'SDKExplorerError';
    return err;
}

/** Mounts the form on a locked token whose holder read runs `holders`. */
function mountDividend(holders) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getHoldersForToken: vi.fn(holders),
    };
    // Any other host read answers empty so the form settles.
    const messaging = new Proxy(target, {
        get: (t, prop) => (prop in t ? t[prop] : () => Promise.resolve([])),
    });
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(DividendForm, {
            walletId: 'w', onBack() {}, initialChainId: CHAIN, initialTick: TICK,
        }),
    ));
    return target.getHoldersForToken;
}

const hint = () => screen.queryByText(/load the holders/);

afterEach(() => {
    cleanup();
});

describe('the Dividend holder-count hint on a failed holder read', () => {
    it('shows one read sentence with no explorer URL for an explorer 502', async () => {
        const holders = mountDividend(async () => {
            throw explorerError(`Explorer returned HTTP 502 for /RBTC/api/holders/${TICK}`);
        });

        await waitFor(() => expect(hint()).toBeTruthy(), { timeout: 4000 });
        const text = hint().textContent;
        expect(text).toMatch(/^Couldn't load the holders\. /);
        expect(text.match(/Couldn't load/g)).toHaveLength(1);
        expect(text).not.toContain('/RBTC/api/');
        expect(text).not.toContain('Explorer returned');
        expect(holders).toHaveBeenCalledWith({ chainId: CHAIN, tick: TICK });
    });

    it('keeps a plain person-written reason after a single opener', async () => {
        mountDividend(async () => { throw new Error('the token has no holders yet'); });

        await waitFor(() => expect(hint()).toBeTruthy(), { timeout: 4000 });
        expect(hint().textContent)
            .toMatch(/^Couldn't load the holders\. the token has no holders yet/);
        expect(hint().textContent.match(/Couldn't load/g)).toHaveLength(1);
    });
});
