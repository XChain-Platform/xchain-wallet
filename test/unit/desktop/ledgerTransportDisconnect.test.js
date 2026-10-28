// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// An unplugged Ledger closes its WebHID transport for good. The desktop
// factory evicts that transport on its disconnect event, so the next pairing
// after the device is plugged back in opens a fresh one.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';

// The Transport class TransportWebHID extends. It offers on, off and emit,
// and no once, so a fake built on EventEmitter alone can pass where the real
// transport does not.
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

function webHidLoader(makeTransport = () => new EventEmitter()) {
    const made = [];
    const create = vi.fn(async () => {
        const transport = makeTransport();
        transport.id = made.length + 1;
        made.push(transport);
        return transport;
    });
    return { loader: vi.fn().mockResolvedValue({ default: { create } }), made };
}

beforeEach(() => resetLedgerTransport());

describe('desktop Ledger transport after an unplug', () => {
    it('opens a fresh transport once the cached one reports disconnect', async () => {
        const { loader, made } = webHidLoader();
        const first = await getLedgerTransport(loader);
        first.emit('disconnect');
        const second = await getLedgerTransport(loader);
        expect(second).not.toBe(first);
        expect(made).toHaveLength(2);
    });

    it('opens a fresh transport once a @ledgerhq transport reports disconnect', async () => {
        const { loader, made } = webHidLoader(() => new LedgerTransport());
        const first = await getLedgerTransport(loader);
        expect(typeof first.once).toBe('undefined');
        first.emit('disconnect');
        const second = await getLedgerTransport(loader);
        expect(second).not.toBe(first);
        expect(made).toHaveLength(2);
        first.emit('disconnect');
        await expect(getLedgerTransport(loader)).resolves.toBe(second);
    });

    it('keeps the live transport when an evicted one reports disconnect late', async () => {
        const { loader } = webHidLoader();
        const first = await getLedgerTransport(loader);
        first.emit('disconnect');
        const second = await getLedgerTransport(loader);
        first.emit('disconnect');
        await expect(getLedgerTransport(loader)).resolves.toBe(second);
    });

    it('drops its disconnect listener on reset', async () => {
        const { loader } = webHidLoader();
        const first = await getLedgerTransport(loader);
        expect(first.listenerCount('disconnect')).toBe(1);
        resetLedgerTransport();
        expect(first.listenerCount('disconnect')).toBe(0);
    });
});
