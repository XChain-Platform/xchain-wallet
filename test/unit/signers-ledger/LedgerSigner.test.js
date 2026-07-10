// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: LedgerSigner: all non-hardware-transport methods via a mocked app.

import { describe, it, expect, vi } from 'vitest';
import {
    LedgerSigner,
    deriveLedgerDeviceIdentifier,
    modelFromLedgerTransport,
} from '../../../packages/signers-ledger/src/LedgerSigner.js';
import { Signer } from '../../../packages/core/src/signers/Signer.js';

function makeApp(overrides = {}) {
    return {
        getAppAndVersion: vi.fn().mockResolvedValue({ name: 'Bitcoin', version: '2.2.1' }),
        getWalletPublicKey: vi.fn().mockResolvedValue({
            publicKey: '02' + 'a'.repeat(64),
            bitcoinAddress: 'bc1qmock',
            chainCode: 'c'.repeat(64),
        }),
        signMessageNew: vi.fn().mockResolvedValue({ v: 0, r: 'a'.repeat(64), s: 'b'.repeat(64) }),
        createPaymentTransaction: vi.fn().mockResolvedValue('signedtxhex'),
        splitTransaction: vi.fn().mockReturnValue({ mockSplit: true }),
        ...overrides,
    };
}

function makeSigner(appOverrides = {}, opts = {}) {
    return new LedgerSigner({
        id: 'ledger-test',
        displayName: 'Ledger (nanoX)',
        model: 'nanoX',
        deviceIdentifier: 'abcdef01',
        app: makeApp(appOverrides),
        ...opts,
    });
}

describe('LedgerSigner constructor', () => {
    it('extends Signer', () => {
        expect(makeSigner()).toBeInstanceOf(Signer);
    });

    it('exposes id, displayName, kind, model, deviceIdentifier', () => {
        const s = makeSigner();
        expect(s.id).toBe('ledger-test');
        expect(s.displayName).toBe('Ledger (nanoX)');
        expect(s.kind).toBe('ledger');
        expect(s.model).toBe('nanoX');
        expect(s.deviceIdentifier).toBe('abcdef01');
    });

    it('requiresPhysicalConfirmation is true', () => {
        expect(makeSigner().requiresPhysicalConfirmation).toBe(true);
    });

    it('throws when id is missing', () => {
        expect(() => new LedgerSigner({ id: '', displayName: 'X', model: 'nanoX', deviceIdentifier: 'x', app: makeApp() }))
            .toThrow(/id is required/);
    });

    it('throws when app is missing', () => {
        expect(() => new LedgerSigner({ id: 'x', displayName: 'X', model: 'nanoX', deviceIdentifier: 'x', app: null }))
            .toThrow(/app is required/);
    });
});

describe('LedgerSigner.getStatus', () => {
    it('returns "available" when app responds + no chainId filter', async () => {
        const s = makeSigner();
        expect(await s.getStatus()).toBe('available');
    });

    it('returns "available" when correct app is open for chainId', async () => {
        const s = makeSigner({ getAppAndVersion: vi.fn().mockResolvedValue({ name: 'Bitcoin', version: '2.0' }) });
        expect(await s.getStatus({ chainId: 'bitcoin-mainnet' })).toBe('available');
    });

    it('returns "wrong-app" when a different app is open', async () => {
        const s = makeSigner({ getAppAndVersion: vi.fn().mockResolvedValue({ name: 'Ethereum', version: '1.0' }) });
        expect(await s.getStatus({ chainId: 'bitcoin-mainnet' })).toBe('wrong-app');
    });

    it('returns "disconnected" when getAppAndVersion throws', async () => {
        const s = makeSigner({ getAppAndVersion: vi.fn().mockRejectedValue(new Error('transport error')) });
        expect(await s.getStatus()).toBe('disconnected');
    });

    it('returns "disconnected" when getAppAndVersion returns no name', async () => {
        const s = makeSigner({ getAppAndVersion: vi.fn().mockResolvedValue({ version: '1.0' }) });
        expect(await s.getStatus()).toBe('disconnected');
    });
});

describe('LedgerSigner.getAddresses', () => {
    it('returns address rows for bitcoin-mainnet (p2wpkh)', async () => {
        const s = makeSigner();
        const rows = await s.getAddresses({
            chainId: 'bitcoin-mainnet',
            accountIndex: 0,
            change: 0,
            startIndex: 0,
            count: 2,
            addressType: 'p2wpkh',
        });
        expect(rows).toHaveLength(2);
        expect(rows[0].index).toBe(0);
        expect(rows[1].index).toBe(1);
        expect(rows[0].address).toBe('bc1qmock');
        expect(rows[0].path).toMatch(/^m\/84'/);
    });

    it('uses legacy format for dogecoin', async () => {
        const s = makeSigner();
        const rows = await s.getAddresses({
            chainId: 'dogecoin-mainnet',
            accountIndex: 0,
            change: 0,
            startIndex: 0,
            count: 1,
        });
        expect(rows).toHaveLength(1);
        expect(rows[0].path).toMatch(/^m\/44'/);
    });

    it('propagates app errors as SignerStatusError', async () => {
        const s = makeSigner({
            getWalletPublicKey: vi.fn().mockRejectedValue(Object.assign(new Error('HID error'), { statusCode: 0x6985 })),
        });
        await expect(s.getAddresses({ chainId: 'bitcoin-mainnet', accountIndex: 0, change: 0, startIndex: 0, count: 1 }))
            .rejects.toThrow(/getWalletPublicKey failed/);
    });

    it('§17.6: passes verify per the flag (device confirmation)', async () => {
        const getWalletPublicKey = vi.fn().mockResolvedValue({
            publicKey: '02' + 'a'.repeat(64), bitcoinAddress: 'bc1qmock', chainCode: 'c'.repeat(64),
        });
        const s = makeSigner({ getWalletPublicKey });
        const params = { chainId: 'bitcoin-mainnet', accountIndex: 0, change: 0, startIndex: 0, count: 1, addressType: 'p2wpkh' };
        await s.getAddresses(params);
        expect(getWalletPublicKey.mock.calls[0][1]).toMatchObject({ verify: false });
        getWalletPublicKey.mockClear();
        await s.getAddresses({ ...params, verify: true });
        expect(getWalletPublicKey.mock.calls[0][1]).toMatchObject({ verify: true });
    });
});

describe('LedgerSigner.getPublicKey', () => {
    it('returns publicKey, chainCode, fingerprint', async () => {
        const s = makeSigner();
        const out = await s.getPublicKey({ chainId: 'bitcoin-mainnet', path: "m/84'/0'/0'" });
        expect(out.publicKey).toBe('02' + 'a'.repeat(64));
        expect(out.chainCode).toBe('c'.repeat(64));
        expect(out.fingerprint).toBe('');
    });
});

describe('LedgerSigner.signMessage', () => {
    it('returns a base64 compact signature', async () => {
        const s = makeSigner();
        const out = await s.signMessage({ message: 'hello', path: "m/84'/0'/0'/0/0" });
        expect(typeof out.signature).toBe('string');
        // 65 bytes → base64 = 88 chars (or 87/86 with padding)
        const decoded = Buffer.from(out.signature, 'base64');
        expect(decoded.length).toBe(65);
    });

    it('throws when message is not a string', async () => {
        const s = makeSigner();
        await expect(s.signMessage({ message: null, path: "m/84'/0'/0'/0/0" })).rejects.toThrow(/message is required/);
    });

    it('throws when path does not start with m/', async () => {
        const s = makeSigner();
        await expect(s.signMessage({ message: 'hi', path: '84/0/0' })).rejects.toThrow(/path is required/);
    });

    it('propagates Ledger SDK errors as SignerStatusError', async () => {
        const s = makeSigner({ signMessageNew: vi.fn().mockRejectedValue(new Error('user rejected')) });
        await expect(s.signMessage({ message: 'hi', path: "m/84'/0'/0'/0/0" }))
            .rejects.toThrow(/signMessageNew failed/);
    });
});

describe('LedgerSigner.signPsbt', () => {
    it('throws when sdkRegistry is not provided', async () => {
        const s = makeSigner();
        await expect(s.signPsbt({ psbtHex: 'cafe', chainId: 'bitcoin-mainnet', signingPaths: [] }))
            .rejects.toThrow(/sdkRegistry/);
    });

    it('throws when psbtHex is empty', async () => {
        const mockSdk = { wallet: { decomposePsbt: vi.fn(), txidOf: vi.fn() } };
        const s = makeSigner({}, { sdkRegistry: { get: () => mockSdk } });
        await expect(s.signPsbt({ psbtHex: '', chainId: 'bitcoin-mainnet', signingPaths: [] }))
            .rejects.toThrow(/psbtHex is required/);
    });
});

describe('LedgerSigner multisig stubs', () => {
    // The message is what the sign screen renders directly (user-facing-
    // language: no Class.method: developer breadcrumb, no raw "MuSig2"/
    // "cosigner" jargon repeated). err.code carries the typed identifier
    // for callers that want to branch, and the qualified technical string
    // survives as err.cause for logs.
    it('signMusig2Round1 throws a plain-language hardware-unsupported error', async () => {
        await expect(makeSigner().signMusig2Round1()).rejects.toMatchObject({
            code: 'HW_MUSIG2_UNSUPPORTED',
            cause: expect.stringMatching(/^LedgerSigner\.signMusig2Round1:/),
        });
        await expect(makeSigner().signMusig2Round1())
            .rejects.not.toThrow(/LedgerSigner\.signMusig2Round1:/);
    });

    it('signMusig2Round2 throws a plain-language hardware-unsupported error', async () => {
        await expect(makeSigner().signMusig2Round2()).rejects.toMatchObject({
            code: 'HW_MUSIG2_UNSUPPORTED',
            cause: expect.stringMatching(/^LedgerSigner\.signMusig2Round2:/),
        });
        await expect(makeSigner().signMusig2Round2())
            .rejects.not.toThrow(/LedgerSigner\.signMusig2Round2:/);
    });

    it('signMultisigClassical throws not-yet-wired', async () => {
        await expect(makeSigner().signMultisigClassical()).rejects.toThrow(/not yet wired/);
    });

    it('signMultisigPsbt throws not-provisioned', async () => {
        await expect(makeSigner().signMultisigPsbt()).rejects.toThrow(/provisioned/);
    });
});

describe('deriveLedgerDeviceIdentifier', () => {
    it('returns a 16-char hex string for a valid pubkey', async () => {
        const id = await deriveLedgerDeviceIdentifier('02' + 'a'.repeat(64));
        expect(typeof id).toBe('string');
        expect(id).toHaveLength(16);
        expect(id).toMatch(/^[0-9a-f]+$/);
    });

    it('is deterministic for the same input', async () => {
        const a = await deriveLedgerDeviceIdentifier('02' + 'b'.repeat(64));
        const b = await deriveLedgerDeviceIdentifier('02' + 'b'.repeat(64));
        expect(a).toBe(b);
    });

    it('differs for different pubkeys', async () => {
        const a = await deriveLedgerDeviceIdentifier('02' + 'a'.repeat(64));
        const b = await deriveLedgerDeviceIdentifier('02' + 'b'.repeat(64));
        expect(a).not.toBe(b);
    });

    it('throws on empty publicKeyHex', async () => {
        await expect(deriveLedgerDeviceIdentifier('')).rejects.toThrow(/required/);
    });
});

describe('modelFromLedgerTransport', () => {
    it('returns nanoS for { id: "nanoS" }', () => {
        expect(modelFromLedgerTransport({ id: 'nanoS' })).toBe('nanoS');
    });

    it('returns nanoSP for { id: "nanoSP" }', () => {
        expect(modelFromLedgerTransport({ id: 'nanoSP' })).toBe('nanoSP');
    });

    it('returns nanoX for { id: "nanoX" }', () => {
        expect(modelFromLedgerTransport({ id: 'nanoX' })).toBe('nanoX');
    });

    it('returns stax for { id: "stax" }', () => {
        expect(modelFromLedgerTransport({ id: 'stax' })).toBe('stax');
    });

    it('defaults to nanoX for unknown id', () => {
        expect(modelFromLedgerTransport({ id: 'flex' })).toBe('nanoX');
    });

    it('defaults to nanoX for null/undefined', () => {
        expect(modelFromLedgerTransport(null)).toBe('nanoX');
        expect(modelFromLedgerTransport(undefined)).toBe('nanoX');
    });

    it('defaults to nanoX when deviceModel has no id string', () => {
        expect(modelFromLedgerTransport({ id: 42 })).toBe('nanoX');
    });
});
