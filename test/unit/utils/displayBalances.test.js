// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Home and the command palette show a wallet's holdings through one loader,
// so a demo wallet's coin opened from the palette reads the same sample
// holdings Home shows, never the empty chain.

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { loadDisplayBalances } from '../../../packages/core/src/shared/utils/displayBalances.js';
import { markDemoWallet, clearDemoWalletId } from '../../../packages/core/src/flows/demoMode.js';
import { synthesizeDemoBalances } from '../../../packages/core/src/flows/demoFixtures.js';

const byChain = {
    'bitcoin-mainnet': [{ address: 'bc1qdemo', label: '', addressType: 'p2wpkh', derivationPath: null }],
};

function fakeMessaging() {
    return {
        getWalletBalances: vi.fn(async () => ({ 'bitcoin-mainnet': [{ address: 'bc1qdemo', balances: null }] })),
        getAddressesByChain: vi.fn(async () => byChain),
    };
}

beforeEach(() => { clearDemoWalletId(); });
afterEach(() => { clearDemoWalletId(); });

describe('loadDisplayBalances', () => {
    it('reads the chain for an ordinary wallet', async () => {
        const messaging = fakeMessaging();
        const out = await loadDisplayBalances(messaging, 'w-real', 'a1');
        expect(messaging.getWalletBalances).toHaveBeenCalledWith('w-real', 'a1');
        expect(messaging.getAddressesByChain).not.toHaveBeenCalled();
        expect(out['bitcoin-mainnet'][0].balances).toBeNull();
    });

    it('shows the synthesized holdings for the demo wallet, as Home does', async () => {
        markDemoWallet('w-demo');
        const messaging = fakeMessaging();
        const out = await loadDisplayBalances(messaging, 'w-demo', 'a1');
        expect(messaging.getAddressesByChain).toHaveBeenCalledWith('w-demo', 'a1');
        expect(messaging.getWalletBalances).not.toHaveBeenCalled();
        expect(out).toEqual(synthesizeDemoBalances(byChain));
    });

    it('falls back to the chain when the shell cannot list addresses', async () => {
        markDemoWallet('w-demo');
        const messaging = fakeMessaging();
        delete messaging.getAddressesByChain;
        await loadDisplayBalances(messaging, 'w-demo', 'a1');
        expect(messaging.getWalletBalances).toHaveBeenCalledWith('w-demo', 'a1');
    });
});
