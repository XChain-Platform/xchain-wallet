// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../packages/core/src/signerFactories/index.js', () => ({
    makeLedgerFactory: vi.fn(),
    walletOnlyRegistry: vi.fn(),
}));
vi.mock('xchain-sdk/src/wallet.js', () => ({ default: {} }));

import {
    getLedgerTransport,
    resetLedgerTransport,
} from '../../../packages/extension/src/signers/ledgerFactory.js';

afterEach(async () => {
    await resetLedgerTransport();
});

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

describe('extension Ledger transport cache', () => {
    it('shares one in-flight transport creation across concurrent callers', async () => {
        const gate = deferred();
        const transport = { close: vi.fn(async () => {}) };
        const create = vi.fn(() => gate.promise);
        const loader = vi.fn(async () => ({ create }));

        const first = getLedgerTransport(loader);
        const second = getLedgerTransport(loader);
        await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
        gate.resolve(transport);

        await expect(Promise.all([first, second])).resolves.toEqual([transport, transport]);
        expect(loader).toHaveBeenCalledOnce();
        expect(create).toHaveBeenCalledOnce();
    });

    it('evicts a disconnected transport', async () => {
        let disconnect;
        const first = {
            once: vi.fn((event, handler) => { disconnect = handler; }),
            off: vi.fn(),
            close: vi.fn(async () => {}),
        };
        const second = { close: vi.fn(async () => {}) };
        const create = vi.fn()
            .mockResolvedValueOnce(first)
            .mockResolvedValueOnce(second);
        const loader = vi.fn(async () => ({ create }));

        await expect(getLedgerTransport(loader)).resolves.toBe(first);
        disconnect();
        await expect(getLedgerTransport(loader)).resolves.toBe(second);

        expect(create).toHaveBeenCalledTimes(2);
    });

    it('removes the disconnect listener and closes the transport on reset', async () => {
        const transport = {
            once: vi.fn(),
            off: vi.fn(),
            close: vi.fn(async () => {}),
        };
        const loader = vi.fn(async () => ({ create: vi.fn(async () => transport) }));

        await getLedgerTransport(loader);
        const handler = transport.once.mock.calls[0][1];
        await resetLedgerTransport();

        expect(transport.off).toHaveBeenCalledWith('disconnect', handler);
        expect(transport.close).toHaveBeenCalledOnce();
    });

    it('closes an in-flight transport that finishes after a reset', async () => {
        const gate = deferred();
        const transport = { close: vi.fn(async () => {}) };
        const loader = vi.fn(async () => ({ create: vi.fn(() => gate.promise) }));

        const pending = getLedgerTransport(loader);
        await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
        await resetLedgerTransport();
        gate.resolve(transport);

        await expect(pending).rejects.toThrow('transport creation was reset');
        expect(transport.close).toHaveBeenCalledOnce();
    });

    it('clears a failed creation so a later pairing can retry', async () => {
        const transport = { close: vi.fn(async () => {}) };
        const create = vi.fn()
            .mockRejectedValueOnce(new Error('device chooser cancelled'))
            .mockResolvedValueOnce(transport);
        const loader = vi.fn(async () => ({ create }));

        await expect(getLedgerTransport(loader)).rejects.toThrow('device chooser cancelled');
        await expect(getLedgerTransport(loader)).resolves.toBe(transport);
        expect(create).toHaveBeenCalledTimes(2);
    });
});
