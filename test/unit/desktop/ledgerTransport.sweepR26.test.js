// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const fromWebHid = createRequire(createRequire(join(process.cwd(), 'packages', 'desktop', 'package.json'))
    .resolve('@ledgerhq/hw-transport-webhid'));
const LedgerTransport = fromWebHid('@ledgerhq/hw-transport').default;

vi.mock('@xchain-wallet/core/signerFactories', () => ({
    makeLedgerFactory: vi.fn(),
    walletOnlyRegistry: vi.fn(() => ({ get: vi.fn() })),
}));
vi.mock('xchain-sdk/src/wallet.js', () => ({
    default: { decomposePsbt: vi.fn(), txidOf: vi.fn() },
}));

const {
    getLedgerTransport,
    resetLedgerTransport,
} = await import('../../../packages/desktop/renderer/signerFactories/ledgerFactory.js');

function deferred() {
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    return { promise, resolve };
}

// A transport whose exchange the test settles by hand, so two calls overlap.
class HeldTransport extends LedgerTransport {
    constructor() {
        super();
        this.log = [];
        this.pending = [];
    }

    exchange(apdu) {
        const d = deferred();
        this.log.push(`start:${apdu.toString('hex')}`);
        this.pending.push({ apdu, d });
        return d.promise.then((reply) => {
            this.log.push(`end:${apdu.toString('hex')}`);
            return reply;
        });
    }
}

const OK = Buffer.from([0x90, 0x00]);

beforeEach(() => resetLedgerTransport());

describe('one Ledger transport, two requests at once', () => {
    it('refuses a second app call while the first holds the transport and never interleaves', async () => {
        const transport = new HeldTransport();
        const first = transport.exchangeAtomicImpl(() => transport.send(0xe0, 0x01, 0, 0, Buffer.from([1])));
        const second = transport.exchangeAtomicImpl(() => transport.send(0xe0, 0x02, 0, 0, Buffer.from([2])));
        await expect(second).rejects.toMatchObject({ name: 'TransportRaceCondition' });
        expect(transport.pending).toHaveLength(1);
        transport.pending[0].d.resolve(OK);
        await expect(first).resolves.toEqual(OK);
        expect(transport.log).toEqual(['start:e00100000101', 'end:e00100000101']);
    });

    it('accepts the next exchange once the first settles', async () => {
        const transport = new HeldTransport();
        const first = transport.send(0xe0, 0x01, 0, 0, Buffer.from([1]));
        transport.pending[0].d.resolve(OK);
        await first;
        const next = transport.send(0xe0, 0x02, 0, 0, Buffer.from([2]));
        transport.pending[1].d.resolve(OK);
        await expect(next).resolves.toEqual(OK);
    });

    it('frees the transport after an exchange that throws mid-way', async () => {
        const transport = new HeldTransport();
        transport.exchange = vi.fn().mockRejectedValueOnce(new Error('device disconnected'))
            .mockResolvedValueOnce(OK);
        await expect(transport.send(0xe0, 0x01, 0, 0)).rejects.toThrow('device disconnected');
        await expect(transport.send(0xe0, 0x02, 0, 0)).resolves.toEqual(OK);
    });

    it('rejects a malformed reply that carries no status word', async () => {
        const transport = new HeldTransport();
        const sent = transport.send(0xe0, 0x01, 0, 0);
        transport.pending[0].d.resolve(Buffer.from([0x6a]));
        await expect(sent).rejects.toBeTruthy();
    });
});

describe('desktop Ledger transport cache under races', () => {
    it('opens one transport when two pairings start together', async () => {
        const create = vi.fn(async () => new EventEmitter());
        const loader = vi.fn().mockResolvedValue({ default: { create } });
        const [a, b] = await Promise.all([getLedgerTransport(loader), getLedgerTransport(loader)]);
        expect({ creates: create.mock.calls.length, same: a === b }).toEqual({ creates: 1, same: true });
    });

    it('keeps no transport cached when a lock resets while the transport is still opening', async () => {
        const opening = deferred();
        const transport = new EventEmitter();
        transport.close = vi.fn();
        const create = vi.fn(() => opening.promise);
        const loader = vi.fn().mockResolvedValue({ default: { create } });
        const pending = getLedgerTransport(loader);
        await Promise.resolve();
        await Promise.resolve();
        resetLedgerTransport();
        opening.resolve(transport);
        await expect(pending).rejects.toThrow('reset while opening');
        expect(transport.close).toHaveBeenCalledTimes(1);
        const fresh = new EventEmitter();
        const create2 = vi.fn(async () => fresh);
        const after = await getLedgerTransport(vi.fn().mockResolvedValue({ default: { create: create2 } }));
        expect({ reusedAcrossLock: after === transport, creates: create2.mock.calls.length, fresh: after === fresh })
            .toEqual({ reusedAcrossLock: false, creates: 1, fresh: true });
    });

    it('lets a retry open the device after a failed open', async () => {
        const transport = new EventEmitter();
        const create = vi.fn()
            .mockRejectedValueOnce(new Error('device busy'))
            .mockResolvedValueOnce(transport);
        const loader = vi.fn().mockResolvedValue({ default: { create } });
        await expect(getLedgerTransport(loader)).rejects.toThrow('device busy');
        await expect(getLedgerTransport(loader)).resolves.toBe(transport);
        expect(create).toHaveBeenCalledTimes(2);
    });
});
