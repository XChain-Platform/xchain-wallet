// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Every form built on `useActionForm` (Create Order, Mint, Sweep, ...)
// opened on `Object.keys(byChain)[0]`: the chain of the wallet's OLDEST
// address, since `addresses.byChain` is built in creation order. A wallet
// that started on Bitcoin opened every Create Order on Bitcoin after a
// whole session of Dogecoin work with a Dogecoin address active.
//
// The forms now open on the last-used chain the wallet records (an
// address made active, an action submitted), behind an explicit chain
// and ahead of the first-key fallback. These drive the real hook and a
// real form rather than the helper alone, because the defect was never
// in a helper: it was the hook not asking.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CreateOrderForm } from '../../../packages/core/src/shared/routes/CreateOrderForm.jsx';
import { useActionForm } from '../../../packages/core/src/shared/hooks/useActionForm.js';

const BTC = 'bitcoin-mainnet';
const DOGE = 'dogecoin-mainnet';
const LTC = 'litecoin-mainnet';

const ADDR_BTC = Object.freeze({
    id: 'addr-btc', address: 'bc1qactiveactiveactiveactiveactiveactive0',
    publicKey: '02aa', derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: 'signer-1',
});
const ADDR_DOGE = Object.freeze({
    id: 'addr-doge', address: 'DHy1Qk7Zx8dCn4eW1sT9pVb2xKq3rLm5Ns',
    publicKey: '02bb', derivationPath: "m/44'/3'/0'/0/0", source: 'hd', signerId: 'signer-1',
});
const ADDR_LTC = Object.freeze({
    id: 'addr-ltc', address: 'ltc1qltcltcltcltcltcltcltcltcltcltcltcltc0',
    publicKey: '02cc', derivationPath: "m/84'/2'/0'/0/0", source: 'hd', signerId: 'signer-1',
});
// Creation order is the map's key order: Bitcoin first, then Dogecoin,
// then Litecoin. The old default read exactly this order.
const ADDRESSES = Object.freeze({ [BTC]: [ADDR_BTC], [DOGE]: [ADDR_DOGE], [LTC]: [ADDR_LTC] });
const ACTIVE = Object.freeze({
    [BTC]: { id: ADDR_BTC.id }, [DOGE]: { id: ADDR_DOGE.id }, [LTC]: { id: ADDR_LTC.id },
});

const settingsWith = (lastUsedChain) => ({
    walletMode: 'full', activeNetwork: 'mainnet', lastUsedChain,
});

function messagingWith(overrides = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ ...ADDRESSES }),
        getActiveAddresses: vi.fn().mockResolvedValue({ ...ACTIVE }),
        getSettings: vi.fn().mockResolvedValue(settingsWith({ mainnet: DOGE })),
        updateSettings: vi.fn().mockResolvedValue({}),
        signerReady: () => Promise.resolve({ ready: true }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        getWalletBalances: () => Promise.resolve({}),
    };
    Object.assign(target, overrides);
    return new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({ rows: [] });
        },
        has: (t, prop) => prop in t,
    });
}

/** Records the hook's output on every render; renders nothing. */
function Probe({ log, options }) {
    const form = useActionForm({
        walletId: 'w',
        action: 'ORDER',
        submitMethods: { hw: 'orderActionHw', software: 'orderAction' },
        ...options,
    });
    log.push({ chainId: form.chainId, fromAddress: form.fromAddress?.address ?? null, submit: form.submit, setChainId: form.setChainId });
    return null;
}

async function probe({ options = {}, messaging = messagingWith() } = {}) {
    const log = [];
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(Probe, { log, options }),
        ),
    );
    await waitFor(() => expect(log[log.length - 1].fromAddress).toBeTruthy());
    return { log, last: () => log[log.length - 1], messaging };
}

afterEach(() => cleanup());

describe('useActionForm chain default follows the last-used chain', () => {
    it('opens on Dogecoin when Bitcoin was created first and Dogecoin was used last', async () => {
        const { last } = await probe();
        expect(last().chainId).toBe(DOGE);
        expect(last().fromAddress).toBe(ADDR_DOGE.address);
    });

    it('Create Order, the form the report was filed on, opens on Dogecoin', async () => {
        const messaging = messagingWith();
        render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(CreateOrderForm, { walletId: 'w', onBack() {} }),
            ),
        );
        expect(await screen.findByRole('button', { name: /^Network: Dogecoin/ })).toBeInTheDocument();
        const from = await screen.findByLabelText('From address');
        await waitFor(() => expect(from.value).toBe(ADDR_DOGE.address));
    });

    it('an explicit initialChainId wins over the last-used chain', async () => {
        const { last } = await probe({ options: { initialChainId: LTC } });
        expect(last().chainId).toBe(LTC);
        expect(last().fromAddress).toBe(ADDR_LTC.address);
    });

    it('falls back to the first chain when the last-used chain has no addresses any more', async () => {
        const messaging = messagingWith({
            getSettings: vi.fn().mockResolvedValue(settingsWith({ mainnet: 'dogecoin-testnet' })),
        });
        const { last } = await probe({ messaging });
        expect(last().chainId).toBe(BTC);
    });

    it('a testnet slot never picks the chain on a mainnet wallet', async () => {
        const messaging = messagingWith({
            getSettings: vi.fn().mockResolvedValue(settingsWith({ testnet: 'dogecoin-testnet' })),
        });
        const { last } = await probe({ messaging });
        expect(last().chainId).toBe(BTC);
    });

    it('still opens (on the first chain) when the host has no getSettings or the read fails', async () => {
        const rejecting = messagingWith({ getSettings: vi.fn().mockRejectedValue(new Error('locked')) });
        const a = await probe({ messaging: rejecting });
        expect(a.last().chainId).toBe(BTC);
        cleanup();
        const target = {
            getAddressesByChain: vi.fn().mockResolvedValue({ ...ADDRESSES }),
            getActiveAddresses: vi.fn().mockResolvedValue({ ...ACTIVE }),
            signerReady: () => Promise.resolve({ ready: true }),
            getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        };
        const without = new Proxy(target, {
            get(t, prop) {
                if (prop in t) return t[prop];
                if (prop === 'getSettings') return undefined;
                return () => Promise.resolve({ rows: [] });
            },
            has: (t, prop) => (prop === 'getSettings' ? false : prop in t),
        });
        const b = await probe({ messaging: without });
        expect(b.last().chainId).toBe(BTC);
    });

    it('a locked token context keeps its chain and is never re-pointed at the last-used one', async () => {
        const { last } = await probe({ options: { initialChainId: BTC, lockedToken: true } });
        expect(last().chainId).toBe(BTC);
    });
});

describe('useActionForm records the chain a submit succeeded on', () => {
    it('a successful submit on Litecoin writes Litecoin as the last-used mainnet chain', async () => {
        const messaging = messagingWith({ orderAction: vi.fn().mockResolvedValue({ txid: 'ab' }) });
        const { last } = await probe({ messaging });
        await act(async () => { last().setChainId(LTC); });
        await waitFor(() => expect(last().fromAddress).toBe(ADDR_LTC.address));
        await act(async () => { await last().submit({ params: {}, password: 'pw' }); });
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({
            lastUsedChain: { mainnet: LTC },
        }));
        expect(messaging.orderAction).toHaveBeenCalledTimes(1);
    });

    it('a failed submit writes nothing', async () => {
        const messaging = messagingWith({ orderAction: vi.fn().mockRejectedValue(new Error('no')) });
        const { last } = await probe({ messaging });
        await expect(last().submit({ params: {}, password: 'pw' })).rejects.toThrow('no');
        await new Promise((r) => { setTimeout(r, 20); });
        expect(messaging.updateSettings).not.toHaveBeenCalled();
    });

    it('a failed preference write does not fail the submit', async () => {
        const messaging = messagingWith({
            orderAction: vi.fn().mockResolvedValue({ txid: 'ab' }),
            updateSettings: vi.fn().mockRejectedValue(new Error('vault locked')),
        });
        const { last } = await probe({ messaging });
        let res;
        await act(async () => { res = await last().submit({ params: {}, password: 'pw' }); });
        expect(res).toEqual({ txid: 'ab' });
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalled());
    });
});
