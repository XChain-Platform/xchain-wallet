// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Switching the Receive chain while an earlier address load is still pending
// never leaves the code or the shown address on the earlier chain.

import { cleanup, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';

const { qrToDataURL } = vi.hoisted(() => ({
    qrToDataURL: vi.fn(async (uri) => `data:image/png;base64,${btoa(uri)}`),
}));

vi.mock('../../packages/core/src/shared/components/ToastHost.jsx', () => ({
    useToast: () => ({ showToast: () => {}, dismissToast: () => {}, clearToasts: () => {} }),
}));
vi.mock('qrcode', () => ({ default: { toDataURL: qrToDataURL } }));

const { Receive } = await import('../../packages/core/src/shared/routes/Receive.jsx');

const BTC = { id: 'a-btc', address: 'bcrt1qbtcaddressaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', addressType: 'p2wpkh', derivationPath: "m/84'/0'/0'/0/0", source: 'hd', label: 'BTC one' };
const LTC = { id: 'a-ltc', address: 'rltc1qltcaddressbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', addressType: 'p2wpkh', derivationPath: "m/84'/2'/0'/0/0", source: 'hd', label: 'LTC one' };

function deferred() {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
}

afterEach(() => { cleanup(); qrToDataURL.mockClear(); });

describe('regression/receive-chain-switch-race', () => {
    it('[REGRESSION P1] a late load for the old chain never replaces the new chain address', async () => {
        const pending = { 'bitcoin-regtest': deferred(), 'litecoin-regtest': deferred() };
        const messaging = {
            getSettings: vi.fn(async () => ({ schemaVersion: 1, activeNetwork: 'regtest' })),
            getAddressesByChain: vi.fn(async () => ({ 'bitcoin-regtest': [BTC], 'litecoin-regtest': [LTC] })),
            getNewestAddress: vi.fn((_w, chainId) => pending[chainId].promise),
        };
        const view = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <Receive walletId="w" accountId="a" prefill={{ chainId: 'bitcoin-regtest' }} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(messaging.getNewestAddress).toHaveBeenCalledTimes(1));
        view.rerender(
            <MessagingProvider shell="web" messaging={messaging}>
                <Receive walletId="w" accountId="a" prefill={{ chainId: 'litecoin-regtest' }} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(messaging.getNewestAddress.mock.calls.some((c) => c[1] === 'litecoin-regtest')).toBe(true));
        await act(async () => { pending['litecoin-regtest'].resolve(LTC); });
        await act(async () => { pending['bitcoin-regtest'].resolve(BTC); });
        await waitFor(() => expect(qrToDataURL).toHaveBeenCalled());
        const last = qrToDataURL.mock.calls.at(-1)[0];
        expect(last).toContain(LTC.address);
        expect(last).not.toContain(BTC.address);
        expect(document.body.textContent).not.toContain(BTC.address);
    });
});
