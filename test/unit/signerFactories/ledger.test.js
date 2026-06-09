// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Unit: core/signerFactories/ledger — makeLedgerFactory DI builder.
// No real Ledger transport — mocked entirely.

import { describe, it, expect, vi } from 'vitest';
import { makeLedgerFactory } from '../../../packages/core/src/signerFactories/ledger.js';
import { LedgerSigner } from '../../../packages/signers-ledger/src/LedgerSigner.js';

function makeValidTransport(modelId = 'nanoX') {
    return {
        deviceModel: { id: modelId },
    };
}

function makeValidApp({ name = 'Bitcoin', version = '2.2.1', publicKey = '02' + 'a'.repeat(64) } = {}) {
    return {
        getAppAndVersion: vi.fn().mockResolvedValue({ name, version }),
        getWalletPublicKey: vi.fn().mockResolvedValue({
            publicKey,
            bitcoinAddress: 'bc1qmock',
            chainCode: 'c'.repeat(64),
        }),
        splitTransaction: vi.fn(),
        createPaymentTransaction: vi.fn(),
        signMessageNew: vi.fn(),
    };
}

describe('makeLedgerFactory', () => {
    it('throws when getTransport is not a function', () => {
        expect(() => makeLedgerFactory({ getTransport: null, getAppClass: vi.fn() }))
            .toThrow('getTransport must be a function');
    });

    it('throws when getAppClass is not a function', () => {
        expect(() => makeLedgerFactory({ getTransport: vi.fn(), getAppClass: null }))
            .toThrow('getAppClass must be a function');
    });

    it('returns a callable pair function', () => {
        const pair = makeLedgerFactory({ getTransport: vi.fn(), getAppClass: vi.fn() });
        expect(typeof pair).toBe('function');
    });

    describe('pairLedgerSigner (happy path)', () => {
        async function pairWithMocks({ modelId = 'nanoX', appName = 'Bitcoin', appVersion = '2.2.1' } = {}) {
            const transport = makeValidTransport(modelId);
            const app = makeValidApp({ name: appName, version: appVersion });
            const getTransport = vi.fn().mockResolvedValue(transport);
            const getAppClass = vi.fn().mockResolvedValue(function Btc({ transport: t, currency }) {
                // Return the mock app instead of constructing.
                return app;
            });

            const pair = makeLedgerFactory({ getTransport, getAppClass });
            return pair();
        }

        it('returns a LedgerSigner + pairingInfo', async () => {
            const result = await pairWithMocks();
            expect(result.signer).toBeInstanceOf(LedgerSigner);
            expect(result.pairingInfo.vendor).toBe('ledger');
            expect(result.pairingInfo.model).toBe('nanoX');
            expect(typeof result.pairingInfo.deviceIdentifier).toBe('string');
            expect(result.pairingInfo.deviceIdentifier.length).toBeGreaterThan(0);
            expect(result.pairingInfo.firmwareVersion).toBe('2.2.1');
        });

        it('maps nanoS model id correctly', async () => {
            const result = await pairWithMocks({ modelId: 'nanoS' });
            expect(result.pairingInfo.model).toBe('nanoS');
        });

        it('maps nanoSP model id correctly', async () => {
            const result = await pairWithMocks({ modelId: 'nanoSP' });
            expect(result.pairingInfo.model).toBe('nanoSP');
        });

        it('defaults model to nanoX for unknown deviceModel', async () => {
            const result = await pairWithMocks({ modelId: 'unknownModel' });
            expect(result.pairingInfo.model).toBe('nanoX');
        });
    });

    describe('pairLedgerSigner (error paths)', () => {
        it('throws when getTransport returns null', async () => {
            const pair = makeLedgerFactory({
                getTransport: vi.fn().mockResolvedValue(null),
                getAppClass: vi.fn(),
            });
            await expect(pair()).rejects.toThrow('returned null');
        });

        it('throws when getAppClass does not return a constructor', async () => {
            const pair = makeLedgerFactory({
                getTransport: vi.fn().mockResolvedValue(makeValidTransport()),
                getAppClass: vi.fn().mockResolvedValue('not a function'),
            });
            await expect(pair()).rejects.toThrow('constructable Btc class');
        });

        it('throws when getAppAndVersion rejects', async () => {
            const app = makeValidApp();
            app.getAppAndVersion = vi.fn().mockRejectedValue(new Error('transport error'));
            const pair = makeLedgerFactory({
                getTransport: vi.fn().mockResolvedValue(makeValidTransport()),
                getAppClass: vi.fn().mockResolvedValue(function Btc() { return app; }),
            });
            await expect(pair()).rejects.toThrow('failed to read app info');
        });

        it('throws when app info has no name', async () => {
            const app = makeValidApp();
            app.getAppAndVersion = vi.fn().mockResolvedValue({ version: '1.0.0' });
            const pair = makeLedgerFactory({
                getTransport: vi.fn().mockResolvedValue(makeValidTransport()),
                getAppClass: vi.fn().mockResolvedValue(function Btc() { return app; }),
            });
            await expect(pair()).rejects.toThrow('app name');
        });

        it('throws when getWalletPublicKey rejects', async () => {
            const app = makeValidApp();
            app.getWalletPublicKey = vi.fn().mockRejectedValue(new Error('hw error'));
            const pair = makeLedgerFactory({
                getTransport: vi.fn().mockResolvedValue(makeValidTransport()),
                getAppClass: vi.fn().mockResolvedValue(function Btc() { return app; }),
            });
            await expect(pair()).rejects.toThrow('identity xpub');
        });
    });
});
