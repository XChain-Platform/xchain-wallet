// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Send opened on `Object.keys(byChain)[0]`, the chain of the wallet's
// oldest address, unless a token context supplied `prefill.chainId`. From
// the nav or the command palette there is no context, so a Bitcoin-first
// wallet opened Send on Bitcoin after a whole session on Dogecoin.
//
// Send now opens on the wallet's last-used chain (behind an explicit
// prefill, ahead of the first-key fallback) and records the chain a send
// succeeded on. The From field is the observable: Send resolves it per
// chain, so the address it shows names the chain the form opened on.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';

const BTC = 'bitcoin-mainnet';
const DOGE = 'dogecoin-mainnet';
const LTC = 'litecoin-mainnet';

const BTC_FROM = 'bc1qsendersendersendersendersendersendersa';
const DOGE_FROM = 'DHy1Qk7Zx8dCn4eW1sT9pVb2xKq3rLm5Ns';
const LTC_FROM = 'ltc1qyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zuxktx9';
const LTC_TO = 'ltc1qxvenxvenxvenxvenxvenxvenxvenxvenwcpknh';

const addr = (id, address, path) => ({ id, address, publicKey: '02ab', derivationPath: path, source: 'hd' });
// Creation order is the map's key order: Bitcoin first. The old default
// read exactly this order.
const ADDRESSES = {
    [BTC]: [addr('addr-btc', BTC_FROM, "m/84'/0'/0'/0/0")],
    [DOGE]: [addr('addr-doge', DOGE_FROM, "m/44'/3'/0'/0/0")],
    [LTC]: [addr('addr-ltc', LTC_FROM, "m/84'/2'/0'/0/0")],
};
const ACTIVE = {
    [BTC]: { id: 'addr-btc', address: BTC_FROM },
    [DOGE]: { id: 'addr-doge', address: DOGE_FROM },
    [LTC]: { id: 'addr-ltc', address: LTC_FROM },
};
const NATIVE_TICK = { [BTC]: 'BTC', [DOGE]: 'DOGE', [LTC]: 'LTC' };

function mount({ settings, prefill, addresses = ADDRESSES, overrides = {} } = {}) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue(addresses),
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
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: '70736274ff', encoding: 'P2SH', actionString: 'SEND|1|…', version: 1,
        }),
        sendToken: vi.fn().mockResolvedValue({ txid: 'deadbeef' }),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        ...overrides,
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
    return messaging;
}

const fromField = () => screen.getByLabelText(/^From$/);

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Send opens on the last-used chain', () => {
    it('opens on Dogecoin when Bitcoin was created first and Dogecoin was used last', async () => {
        mount({ settings: { lastUsedChain: { mainnet: DOGE } } });
        await waitFor(() => expect(fromField().value).toBe(DOGE_FROM));
    });

    it('a prefilled chain (a token context) wins over the last-used chain', async () => {
        mount({ settings: { lastUsedChain: { mainnet: DOGE } }, prefill: { chainId: BTC } });
        await waitFor(() => expect(fromField().value).toBe(BTC_FROM));
        // And stays: the load must not re-point a prefilled form.
        await new Promise((r) => { setTimeout(r, 50); });
        expect(fromField().value).toBe(BTC_FROM);
    });

    it('falls back to the first chain when the last-used chain has no addresses any more', async () => {
        const { [LTC]: _gone, ...withoutLtc } = ADDRESSES;
        mount({ settings: { lastUsedChain: { mainnet: LTC } }, addresses: withoutLtc });
        await waitFor(() => expect(fromField().value).toBe(BTC_FROM));
    });

    it('a testnet slot never picks the chain on a mainnet wallet', async () => {
        mount({ settings: { lastUsedChain: { testnet: 'dogecoin-testnet' } } });
        await waitFor(() => expect(fromField().value).toBe(BTC_FROM));
    });

    it('still opens, on the first chain, when the settings read fails', async () => {
        mount({ overrides: { getSettings: vi.fn().mockRejectedValue(new Error('locked')) } });
        await waitFor(() => expect(fromField().value).toBe(BTC_FROM));
    });
});

describe('Send records the chain a send succeeded on', () => {
    it('a successful send on Litecoin writes Litecoin as the last-used mainnet chain', async () => {
        const messaging = mount({
            settings: { lastUsedChain: { mainnet: BTC } },
            prefill: { chainId: LTC },
        });
        await waitFor(() => expect(fromField().value).toBe(LTC_FROM));

        fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: LTC_TO } });
        fireEvent.change(await screen.findByLabelText(/^Amount \(/), { target: { value: '0.01' } });
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        const approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve).not.toBeDisabled());
        fireEvent.click(approve);
        await waitFor(() => expect(messaging.sendToken).toHaveBeenCalled());

        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({
            lastUsedChain: { mainnet: LTC },
        }));
    });

    it('a send that fails writes nothing', async () => {
        // Send logs the failure itself; keep the run's output clean.
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const messaging = mount({
            prefill: { chainId: LTC },
            overrides: { sendToken: vi.fn().mockRejectedValue(new Error('broadcast refused')) },
        });
        await waitFor(() => expect(fromField().value).toBe(LTC_FROM));

        fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: LTC_TO } });
        fireEvent.change(await screen.findByLabelText(/^Amount \(/), { target: { value: '0.01' } });
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        const approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve).not.toBeDisabled());
        fireEvent.click(approve);
        await waitFor(() => expect(messaging.sendToken).toHaveBeenCalled());

        await new Promise((r) => { setTimeout(r, 50); });
        expect(messaging.updateSettings).not.toHaveBeenCalled();
    });
});
