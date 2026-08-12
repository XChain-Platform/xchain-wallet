// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: core/signerFactories/ledger: makeLedgerFactory DI builder.
// No real Ledger transport; mocked entirely.

import { describe, it, expect, vi } from 'vitest';
import { makeLedgerFactory } from '../../../packages/core/src/signerFactories/ledger.js';
import { LedgerSigner } from '../../../packages/signers-ledger/src/LedgerSigner.js';

/**
 * BOLOS GET_APP_AND_VERSION bytes: the app name and version arrive on the
 * transport, not from an app-client method (appInfo.js).
 */
function appInfoBytes(name = 'Bitcoin', version = '2.2.1') {
    const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
    return Uint8Array.from([
        1,
        name.length, ...ascii(name),
        version.length, ...ascii(version),
        1, 0,
        0x90, 0x00,
    ]);
}

function makeValidTransport({ modelId = 'nanoX', name, version, send } = {}) {
    return {
        deviceModel: { id: modelId },
        send: send ?? vi.fn().mockResolvedValue(appInfoBytes(name, version)),
    };
}

function makeValidApp({ publicKey = '02' + 'a'.repeat(64) } = {}) {
    // Mirrors the real hw-app-btc `Btc` prototype; see
    // test/unit/signers-ledger/hw-app-btc-surface.test.js.
    return {
        getWalletPublicKey: vi.fn().mockResolvedValue({
            publicKey,
            bitcoinAddress: 'bc1qmock',
            chainCode: 'c'.repeat(64),
        }),
        splitTransaction: vi.fn(),
        createPaymentTransaction: vi.fn(),
        signMessage: vi.fn(),
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
            const transport = makeValidTransport({ modelId, name: appName, version: appVersion });
            const app = makeValidApp();
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

        it('throws when the app-info read rejects', async () => {
            const app = makeValidApp();
            const pair = makeLedgerFactory({
                getTransport: vi.fn().mockResolvedValue(makeValidTransport({
                    send: vi.fn().mockRejectedValue(new Error('transport error')),
                })),
                getAppClass: vi.fn().mockResolvedValue(function Btc() { return app; }),
            });
            await expect(pair()).rejects.toThrow('failed to read app info');
        });

        it('throws when app info has no name', async () => {
            const app = makeValidApp();
            const pair = makeLedgerFactory({
                getTransport: vi.fn().mockResolvedValue(makeValidTransport({ name: '' })),
                getAppClass: vi.fn().mockResolvedValue(function Btc() { return app; }),
            });
            await expect(pair()).rejects.toThrow('app name');
        });

        // The Test app answers app-info fine and then rejects the coin-type 0'
        // identity path with a bare 0x6a82. Name the cause at pair time
        // instead of surfacing the device's error code.
        // The signer this factory returns is the exact instance the shells
        // register with signerBridge, and signPsbt needs an SDKRegistry. No
        // shell passes one today, so hardware PSBT signing fails with
        // "requires an sdkRegistry". These two pin both halves:
        // the passthrough works, and its absence is what production hits.
        it('passes an sdkRegistry through to the signer when given one', async () => {
            const app = makeValidApp();
            const sdkRegistry = { get: () => ({ wallet: { decomposePsbt: vi.fn(), txidOf: vi.fn() } }) };
            const pair = makeLedgerFactory({
                getTransport: vi.fn().mockResolvedValue(makeValidTransport()),
                getAppClass: vi.fn().mockResolvedValue(function Btc() { return app; }),
                sdkRegistry,
            });
            const { signer } = await pair();
            await expect(signer.signPsbt({ psbtHex: '', chainId: 'bitcoin-mainnet', signingPaths: [] }))
                .rejects.toThrow(/psbtHex is required/);
        });

        it('leaves the signer unable to signPsbt when no sdkRegistry is given', async () => {
            const app = makeValidApp();
            const pair = makeLedgerFactory({
                getTransport: vi.fn().mockResolvedValue(makeValidTransport()),
                getAppClass: vi.fn().mockResolvedValue(function Btc() { return app; }),
            });
            const { signer } = await pair();
            await expect(signer.signPsbt({ psbtHex: 'cafe', chainId: 'bitcoin-mainnet', signingPaths: [] }))
                .rejects.toThrow(/requires an sdkRegistry/);
        });

        it('names the Bitcoin Test app rather than failing on the identity xpub', async () => {
            const app = makeValidApp();
            const pair = makeLedgerFactory({
                getTransport: vi.fn().mockResolvedValue(makeValidTransport({ name: 'Bitcoin Test', version: '2.5.0' })),
                getAppClass: vi.fn().mockResolvedValue(function Btc() { return app; }),
            });
            await expect(pair()).rejects.toThrow(/Open the Bitcoin app to pair/);
            expect(app.getWalletPublicKey).not.toHaveBeenCalled();
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
