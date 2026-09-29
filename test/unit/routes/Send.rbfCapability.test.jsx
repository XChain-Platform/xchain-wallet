// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The per-send Replace-by-fee switch follows the chain descriptor's
// feeStrategy.rbfSupported. Dogecoin declares it false, so the switch is off
// and disabled there whether or not a fee entry is stored, and a stored
// rbfByDefault:true cannot turn it on. Bitcoin keeps the switch live.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';

const BTC = 'bitcoin-mainnet';
const DOGE = 'dogecoin-mainnet';

const BTC_FROM = 'bc1qsendersendersendersendersendersendersa';
const DOGE_FROM = 'DHy1Qk7Zx8dCn4eW1sT9pVb2xKq3rLm5Ns';

const addr = (id, address, path) => ({ id, address, publicKey: '02ab', derivationPath: path, source: 'hd' });
const ADDRESSES = {
    [BTC]: [addr('addr-btc', BTC_FROM, "m/84'/0'/0'/0/0")],
    [DOGE]: [addr('addr-doge', DOGE_FROM, "m/44'/3'/0'/0/0")],
};
const ACTIVE = {
    [BTC]: { id: 'addr-btc', address: BTC_FROM },
    [DOGE]: { id: 'addr-doge', address: DOGE_FROM },
};
const NATIVE_TICK = { [BTC]: 'BTC', [DOGE]: 'DOGE' };

function mount({ settings, prefill } = {}) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue(ACTIVE),
        getAddressBalances: vi.fn(async (chainId) => ({
            native: { tick: NATIVE_TICK[chainId] || 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [],
        })),
        getSettings: vi.fn().mockResolvedValue({
            grace: { testSendThresholdSats: 0 },
            activeNetwork: 'mainnet',
            ...settings,
        }),
        updateSettings: vi.fn().mockResolvedValue({}),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: true }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        getAddressHistory: vi.fn().mockResolvedValue([]),
    };
    const messaging = new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[prop] = stub;
            return stub;
        },
    });
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(Send, { walletId: 'w', onBack() {}, prefill: prefill || null }),
        ),
    );
}

const fromField = () => screen.getByLabelText(/^From$/);
const rbfSwitch = () => screen.getByLabelText('Replace-by-fee enabled');

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Send RBF switch follows the chain RBF capability', () => {
    it('is off and disabled on Dogecoin with no stored fee entry', async () => {
        mount({ prefill: { chainId: DOGE } });
        await waitFor(() => expect(fromField().value).toBe(DOGE_FROM));
        await waitFor(() => expect(rbfSwitch().checked).toBe(false));
        expect(rbfSwitch().disabled).toBe(true);
        fireEvent.click(rbfSwitch());
        expect(rbfSwitch().checked).toBe(false);
    });

    it('stays off on Dogecoin when a stored entry says rbfByDefault true', async () => {
        mount({
            prefill: { chainId: DOGE },
            settings: { fees: { [DOGE]: { strategy: null, customSatsPerKb: null, rbfByDefault: true } } },
        });
        await waitFor(() => expect(fromField().value).toBe(DOGE_FROM));
        await new Promise((r) => { setTimeout(r, 50); });
        expect(rbfSwitch().checked).toBe(false);
        expect(rbfSwitch().disabled).toBe(true);
    });

    it('is live on Bitcoin and follows a stored rbfByDefault false', async () => {
        mount({
            prefill: { chainId: BTC },
            settings: { fees: { [BTC]: { strategy: null, customSatsPerKb: null, rbfByDefault: false } } },
        });
        await waitFor(() => expect(fromField().value).toBe(BTC_FROM));
        await waitFor(() => expect(rbfSwitch().checked).toBe(false));
        expect(rbfSwitch().disabled).toBe(false);
        fireEvent.click(rbfSwitch());
        expect(rbfSwitch().checked).toBe(true);
    });
});
