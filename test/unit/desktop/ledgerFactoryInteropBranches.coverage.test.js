// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    makeLedgerFactory: vi.fn(),
    walletOnlyRegistry: vi.fn(() => ({ get: vi.fn() })),
    decomposePsbt: vi.fn(),
    txidOf: vi.fn(),
}));

vi.mock('@xchain-wallet/core/signerFactories', () => ({
    makeLedgerFactory: mocks.makeLedgerFactory,
    walletOnlyRegistry: mocks.walletOnlyRegistry,
}));
vi.mock('xchain-sdk/src/wallet.js', () => ({
    default: undefined,
    decomposePsbt: mocks.decomposePsbt,
    txidOf: mocks.txidOf,
}));

const { pairLedgerSigner, resetLedgerTransport } = await import(
    '../../../packages/desktop/renderer/signerFactories/ledgerFactory.js'
);

beforeEach(() => {
    resetLedgerTransport();
    vi.clearAllMocks();
});

describe('desktop Ledger factory module interop branches', () => {
    it('accepts direct wallet, app, and transport module exports', async () => {
        const transport = { id: 'direct-transport' };
        const Transport = { create: vi.fn().mockResolvedValue(transport) };
        const App = function LedgerApp() {};
        const paired = { signer: { vendor: 'ledger' } };
        mocks.makeLedgerFactory.mockImplementation((options) => async () => ({ paired, options }));

        const result = await pairLedgerSigner({
            transportLoader: async () => Transport,
            appLoader: async () => App,
        });

        await expect(result.options.getTransport()).resolves.toBe(transport);
        await expect(result.options.getAppClass()).resolves.toBe(App);
        expect(result.paired).toBe(paired);
        expect(mocks.walletOnlyRegistry).toHaveBeenCalledWith(expect.objectContaining({
            decomposePsbt: mocks.decomposePsbt,
            txidOf: mocks.txidOf,
        }));
    });
});
