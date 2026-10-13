// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { makeLedgerFactory, walletOnlyRegistry } = vi.hoisted(() => ({
    makeLedgerFactory: vi.fn(),
    walletOnlyRegistry: vi.fn(() => ({ get: vi.fn() })),
}));

vi.mock('@xchain-wallet/core/signerFactories', () => ({
    makeLedgerFactory,
    walletOnlyRegistry,
}));
vi.mock('xchain-sdk/src/wallet.js', () => ({
    default: { decomposePsbt: vi.fn(), txidOf: vi.fn() },
}));

const {
    getLedgerTransport,
    pairLedgerSigner,
    resetLedgerTransport,
} = await import('../../../packages/desktop/renderer/signerFactories/ledgerFactory.js');

beforeEach(() => {
    resetLedgerTransport();
    makeLedgerFactory.mockReset();
});

describe('desktop Ledger factory wrapper', () => {
    it('unwraps and caches a default WebHID transport class', async () => {
        const transport = { deviceModel: { id: 'nanoX' } };
        const create = vi.fn().mockResolvedValue(transport);
        const loader = vi.fn().mockResolvedValue({ default: { create } });

        await expect(getLedgerTransport(loader)).resolves.toBe(transport);
        await expect(getLedgerTransport(loader)).resolves.toBe(transport);

        expect(loader).toHaveBeenCalledOnce();
        expect(create).toHaveBeenCalledOnce();
    });

    it('accepts a direct WebHID transport class and resets its cache', async () => {
        const first = { id: 'first' };
        const second = { id: 'second' };
        const create = vi.fn()
            .mockResolvedValueOnce(first)
            .mockResolvedValueOnce(second);
        const loader = vi.fn().mockResolvedValue({ create });

        await expect(getLedgerTransport(loader)).resolves.toBe(first);
        resetLedgerTransport();
        await expect(getLedgerTransport(loader)).resolves.toBe(second);

        expect(loader).toHaveBeenCalledTimes(2);
    });

    it('rejects a module without a WebHID create method', async () => {
        await expect(getLedgerTransport(async () => ({ default: {} })))
            .rejects.toThrow('does not look like @ledgerhq/hw-transport-webhid');
    });

    it('binds transport and app loaders into the core factory', async () => {
        const transport = { id: 'transport' };
        const App = function App() {};
        const pairResult = { signer: { vendor: 'ledger' } };
        const pair = vi.fn().mockResolvedValue(pairResult);
        const transportLoader = vi.fn().mockResolvedValue({ create: vi.fn().mockResolvedValue(transport) });
        const appLoader = vi.fn().mockResolvedValue({ default: App });
        makeLedgerFactory.mockReturnValue(pair);

        await expect(pairLedgerSigner({ transportLoader, appLoader })).resolves.toBe(pairResult);

        expect(makeLedgerFactory).toHaveBeenCalledOnce();
        const options = makeLedgerFactory.mock.calls[0][0];
        await expect(options.getTransport()).resolves.toBe(transport);
        await expect(options.getAppClass()).resolves.toBe(App);
        expect(options.sdkRegistry).toEqual(expect.objectContaining({ get: expect.any(Function) }));
        expect(pair).toHaveBeenCalledOnce();
    });
});
