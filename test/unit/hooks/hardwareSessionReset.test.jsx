// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A lock or a wallet switch resets the Trezor Connect instance and the Ledger
// transport each shell's loaded factories hold, so a device session does not
// outlive the wallet that opened it.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { renderHook, waitFor } from '@testing-library/react';
import {
    trackHardwareFactories, useHardwareSessionReset,
} from '../../../packages/core/src/shared/hooks/useHardwareSessionReset.js';

function fakeModules() {
    const trezor = { pairTrezorSigner: vi.fn(async () => 'trezor-signer'), resetTrezorConnect: vi.fn() };
    const ledger = { pairLedgerSigner: vi.fn(async () => 'ledger-signer'), resetLedgerTransport: vi.fn(async () => {}) };
    const loaders = { trezor: vi.fn(async () => trezor), ledger: vi.fn(async () => ledger) };
    return { trezor, ledger, loaders };
}

describe('trackHardwareFactories', () => {
    it('resets only the factory modules a pairing loaded', async () => {
        const { trezor, ledger, loaders } = fakeModules();
        const tracked = trackHardwareFactories(loaders);
        await tracked.reset();
        expect(loaders.trezor).not.toHaveBeenCalled();
        expect(loaders.ledger).not.toHaveBeenCalled();

        await tracked.load('ledger');
        await tracked.reset();
        expect(ledger.resetLedgerTransport).toHaveBeenCalledTimes(1);
        expect(trezor.resetTrezorConnect).not.toHaveBeenCalled();
        expect(loaders.trezor).not.toHaveBeenCalled();
    });

    it('imports a module once and retries one whose import failed', async () => {
        const { trezor, loaders } = fakeModules();
        loaders.trezor.mockRejectedValueOnce(new Error('chunk failed'));
        const tracked = trackHardwareFactories(loaders);
        await expect(tracked.load('trezor')).rejects.toThrow('chunk failed');
        await expect(tracked.load('trezor')).resolves.toBe(trezor);
        await tracked.load('trezor');
        expect(loaders.trezor).toHaveBeenCalledTimes(2);
    });

    it('keeps resetting the rest when one reset throws', async () => {
        const { trezor, ledger, loaders } = fakeModules();
        trezor.resetTrezorConnect.mockImplementation(() => { throw new Error('bridge gone'); });
        const tracked = trackHardwareFactories(loaders);
        await tracked.load('trezor');
        await tracked.load('ledger');
        await tracked.reset();
        expect(ledger.resetLedgerTransport).toHaveBeenCalledTimes(1);
    });
});

describe('useHardwareSessionReset', () => {
    it('resets on lock and on a wallet switch, not on the first unlock', async () => {
        const reset = vi.fn();
        const { rerender } = renderHook(({ id }) => useHardwareSessionReset(id, reset), {
            initialProps: { id: null },
        });
        rerender({ id: 'wallet-a' });
        await Promise.resolve();
        expect(reset).not.toHaveBeenCalled();

        rerender({ id: 'wallet-b' });
        await waitFor(() => expect(reset).toHaveBeenCalledTimes(1));

        rerender({ id: null });
        await waitFor(() => expect(reset).toHaveBeenCalledTimes(2));

        rerender({ id: null });
        rerender({ id: 'wallet-b' });
        await Promise.resolve();
        expect(reset).toHaveBeenCalledTimes(2);
    });
});

describe('the shells wire the reset', () => {
    const shells = [
        ['web/src/App.jsx', ['trezor', 'ledger']],
        ['desktop/renderer/App.jsx', ['trezor', 'ledger']],
        ['extension/src/popup/App.jsx', ['ledger']],
    ];
    for (const [file, vendors] of shells) {
        it(`${file} pairs through the tracker and resets on the active wallet`, () => {
            const src = readFileSync(`packages/${file}`, 'utf8');
            expect(src).toMatch(/useHardwareSessionReset\(activeWalletId, resetHardwareSessions\)/);
            for (const vendor of vendors) {
                expect(src).toContain(`hardwareFactories.load('${vendor}')`);
            }
            // No pairing path imports a factory around the tracker.
            expect(src).not.toMatch(/=\s*\(\.\.\.args\)\s*=>\s*import\(/);
        });
    }
});

describe('desktop resetLedgerTransport', () => {
    it('closes the cached transport', async () => {
        vi.resetModules();
        vi.doMock('@ledgerhq/hw-app-btc', () => ({ default: class {} }));
        vi.doMock('xchain-sdk/src/wallet.js', () => ({ default: { decomposePsbt: vi.fn(), txidOf: vi.fn() } }));
        const { getLedgerTransport, resetLedgerTransport } = await import(
            '../../../packages/desktop/renderer/signerFactories/ledgerFactory.js'
        );
        const transport = new EventEmitter();
        transport.close = vi.fn(async () => {});
        const loader = vi.fn().mockResolvedValue({ default: { create: vi.fn(async () => transport) } });
        await getLedgerTransport(loader);
        resetLedgerTransport();
        await waitFor(() => expect(transport.close).toHaveBeenCalledTimes(1));
        expect(transport.listenerCount('disconnect')).toBe(0);
    });
});
