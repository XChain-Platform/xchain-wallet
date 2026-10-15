// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Swap keeps its own loader rather than useActionForm, so it carried its
// own copy of the first-created-chain default. It opens on the same shared
// rule now: an explicit chain, then the last-used chain, then the first.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SwapForm } from '../../../packages/core/src/shared/routes/SwapForm.jsx';

const BTC = 'bitcoin-mainnet';
const DOGE = 'dogecoin-mainnet';
const LTC = 'litecoin-mainnet';

const addr = (id, address, path) => ({ id, address, publicKey: '02ab', derivationPath: path, source: 'hd', signerId: 's' });
const ADDRESSES = {
    [BTC]: [addr('addr-btc', 'bc1qsendersendersendersendersendersendersa', "m/84'/0'/0'/0/0")],
    [DOGE]: [addr('addr-doge', 'DHy1Qk7Zx8dCn4eW1sT9pVb2xKq3rLm5Ns', "m/44'/3'/0'/0/0")],
};

function mount({ settings = {}, props = {}, addresses = ADDRESSES } = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue(addresses),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet', ...settings }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        getWalletBalances: () => Promise.resolve({}),
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({ rows: [] });
        },
        has: (t, prop) => prop in t,
    });
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(SwapForm, { walletId: 'w', onBack() {}, ...props }),
        ),
    );
}

const chainButton = () => screen.findByRole('button', { name: /^Give and get network: / });

afterEach(() => cleanup());

describe('SwapForm opens on the last-used network', () => {
    it('does not render the selected network kind', async () => {
        const chainId = 'bitcoin-regtest';
        mount({
            settings: { activeNetwork: 'regtest' },
            props: { initialChainId: chainId },
            addresses: { [chainId]: ADDRESSES[BTC] },
        });

        await screen.findByRole('button', { name: 'Give and get network: Bitcoin' });
        expect(document.body).not.toHaveTextContent(/regtest|testnet|Not mainnet/i);
    });

    it('opens on Dogecoin when Bitcoin was created first and Dogecoin was used last', async () => {
        mount({ settings: { lastUsedChain: { mainnet: DOGE } } });
        await waitFor(async () => expect((await chainButton()).getAttribute('aria-label')).toBe('Give and get network: Dogecoin'));
    });

    it('a caller-seeded network wins over the last-used network', async () => {
        mount({ settings: { lastUsedChain: { mainnet: DOGE } }, props: { initialChainId: BTC } });
        await waitFor(async () => expect((await chainButton()).getAttribute('aria-label')).toBe('Give and get network: Bitcoin'));
    });

    it('falls back to the first network when the last-used network has no addresses', async () => {
        mount({ settings: { lastUsedChain: { mainnet: LTC } } });
        await waitFor(async () => expect((await chainButton()).getAttribute('aria-label')).toBe('Give and get network: Bitcoin'));
    });
});
