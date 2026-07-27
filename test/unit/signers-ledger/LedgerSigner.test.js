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
    coinTypeFor,
} from '../../../packages/signers-ledger/src/LedgerSigner.js';
import { Signer } from '../../../packages/core/src/signers/Signer.js';
import { BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/descriptors/index.js';

// coinTypeFor's SLIP-44 slots (bitcoin-mainnet=0', litecoin-mainnet=2',
// dogecoin-mainnet=3') are a second, independently-hardcoded copy of the same
// coin-type the chain descriptors' derivationPaths declare, and a third copy
// lives in the Trezor signer. They agree today, but nothing guards against a
// future descriptor edit silently diverging hardware from software derivation
// for the same account (funds appear missing). This mirrors the Trezor
// parity test (test/unit/signers-trezor/TrezorSigner.test.js) so both hardware
// signers are locked to the descriptor coin-type slot.
const LEDGER_CHAIN_TO_MAINNET_DESCRIPTOR_ID = {
    'bitcoin-mainnet': 'bitcoin-mainnet',
    'litecoin-mainnet': 'litecoin-mainnet',
    'dogecoin-mainnet': 'dogecoin-mainnet',
};

function descriptorCoinType(descriptorId) {
    const descriptor = BUNDLED_DESCRIPTORS.find((d) => d.id === descriptorId);
    if (!descriptor) throw new Error(`no bundled descriptor "${descriptorId}"`);
    const [firstTemplate] = Object.values(descriptor.derivationPaths);
    const m = firstTemplate.match(/^m\/\d+'\/(\d+')\//);
    if (!m) throw new Error(`${descriptorId}: unrecognized derivation template "${firstTemplate}"`);
    return m[1];
}

describe('coinTypeFor vs chain descriptor coin-type parity', () => {
    Object.entries(LEDGER_CHAIN_TO_MAINNET_DESCRIPTOR_ID).forEach(([chainId, descriptorId]) => {
        it(`${chainId}: coinTypeFor matches the ${descriptorId} descriptor's coin-type slot`, () => {
            expect(coinTypeFor(chainId)).toBe(descriptorCoinType(descriptorId));
        });
    });

    it('rejects bitcoin-testnet and bitcoin-regtest rather than deriving at 1', () => {
        expect(() => coinTypeFor('bitcoin-testnet')).toThrow(/software wallet/);
        expect(() => coinTypeFor('bitcoin-regtest')).toThrow(/software wallet/);
    });
});

function makeApp(overrides = {}) {
    // Only methods the real hw-app-btc `Btc` class ships. The device's
    // app name/version is NOT one of them, it is read off the transport
    // (see appInfo.js and hw-app-btc-surface.test.js).
    return {
        getWalletPublicKey: vi.fn().mockResolvedValue({
            publicKey: '02' + 'a'.repeat(64),
            bitcoinAddress: 'bc1qmock',
            chainCode: 'c'.repeat(64),
        }),
        signMessage: vi.fn().mockResolvedValue({ v: 0, r: 'a'.repeat(64), s: 'b'.repeat(64) }),
        createPaymentTransaction: vi.fn().mockResolvedValue('signedtxhex'),
        splitTransaction: vi.fn().mockReturnValue({ mockSplit: true }),
        ...overrides,
    };
}

/**
 * BOLOS GET_APP_AND_VERSION response bytes, so getStatus exercises the
 * real parser rather than a pre-parsed object a device never sends.
 * Layout: format, len+name, len+version, len+flags.
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

function makeTransport({ name, version, send } = {}) {
    return { send: send ?? vi.fn().mockResolvedValue(appInfoBytes(name, version)) };
}

function makeSigner(appOverrides = {}, opts = {}) {
    return new LedgerSigner({
        id: 'ledger-test',
        displayName: 'Ledger (nanoX)',
        model: 'nanoX',
        deviceIdentifier: 'abcdef01',
        app: makeApp(appOverrides),
        transport: makeTransport(),
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
        const s = makeSigner({}, { transport: makeTransport({ name: 'Bitcoin', version: '2.0' }) });
        expect(await s.getStatus({ chainId: 'bitcoin-mainnet' })).toBe('available');
    });

    it('returns "wrong-app" when a different app is open', async () => {
        const s = makeSigner({}, { transport: makeTransport({ name: 'Ethereum', version: '1.0' }) });
        expect(await s.getStatus({ chainId: 'bitcoin-mainnet' })).toBe('wrong-app');
    });

    // The Bitcoin Test app answers app-info happily; it is the derivation
    // that diverges (coin-type 1'), so it must read as the wrong app rather
    // than as an available one.
    it('returns "wrong-app" when the Bitcoin Test app is open', async () => {
        const s = makeSigner({}, { transport: makeTransport({ name: 'Bitcoin Test', version: '2.5.0' }) });
        expect(await s.getStatus({ chainId: 'bitcoin-mainnet' })).toBe('wrong-app');
    });

    it('returns "disconnected" when the app-info read throws', async () => {
        const s = makeSigner({}, {
            transport: makeTransport({ send: vi.fn().mockRejectedValue(new Error('transport error')) }),
        });
        expect(await s.getStatus()).toBe('disconnected');
    });

    it('returns "disconnected" when the device answers with no app name', async () => {
        const s = makeSigner({}, { transport: makeTransport({ name: '' }) });
        expect(await s.getStatus()).toBe('disconnected');
    });

    it('returns "disconnected" when the response is not BOLOS format 1', async () => {
        const s = makeSigner({}, {
            transport: makeTransport({ send: vi.fn().mockResolvedValue(Uint8Array.from([9, 0, 0])) }),
        });
        expect(await s.getStatus()).toBe('disconnected');
    });

    // Hardware-unsupported chainIds (non-mainnet BTC, and LTC/DOGE non-mainnet)
    // are absent from LEDGER_APP_NAME_FOR_CHAIN and throw at derivation time in
    // coinTypeFor/chainIdToLedgerFormat. getStatus must surface that up front
    // instead of reporting 'available' and failing on the next call.
    for (const chainId of [
        'bitcoin-testnet',
        'bitcoin-regtest',
        'litecoin-testnet',
        'dogecoin-regtest',
    ]) {
        it(`returns "unsupported-network" for ${chainId}`, async () => {
            const s = makeSigner({}, { transport: makeTransport({ name: 'Bitcoin', version: '2.0' }) });
            expect(await s.getStatus({ chainId })).toBe('unsupported-network');
        });
    }
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

    // Omitting the format makes hw-app-btc default to 'legacy', and the
    // Bitcoin app answers 0x6a80 for a legacy request on a segwit path.
    // getAddresses always passed one; getPublicKey did not, so it failed
    // against real hardware on every purpose except 44' .
    it.each([
        ["m/84'/0'/0'/0/0", 'bech32'],
        ["m/49'/0'/0'/0/0", 'p2sh'],
        ["m/44'/0'/0'/0/0", 'legacy'],
    ])('sends the address format implied by %s', async (path, format) => {
        const app = makeApp();
        const s = makeSigner(app);
        await s.getPublicKey({ chainId: 'bitcoin-mainnet', path });
        expect(app.getWalletPublicKey).toHaveBeenCalledWith(path, { verify: false, format });
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
        const s = makeSigner({ signMessage: vi.fn().mockRejectedValue(new Error('user rejected')) });
        await expect(s.signMessage({ message: 'hi', path: "m/84'/0'/0'/0/0" }))
            .rejects.toThrow(/signMessage failed/);
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

    // hw-app-btc v10 dropped `hasTimestamp`, so splitTransaction takes
    // (hex, isSegwitSupported, hasExtraData, additionals). The old 5-arg
    // call shifted `false` into additionals and dropped the real array,
    // which blew up inside the library as `additionals.includes is not a
    // function` on the first real signing attempt .
    it('calls splitTransaction with the v10 four-argument signature', async () => {
        const prevTxHex = '0100000001' + '00'.repeat(32) + 'ffffffff00ffffffff01e8030000'
            + '00000000160014' + 'bb'.repeat(20) + '00000000';
        const mockSdk = {
            wallet: {
                decomposePsbt: vi.fn().mockReturnValue({
                    inputs: [{
                        scriptType: 'p2wpkh',
                        prevTxHash: 'a'.repeat(64),
                        prevTxIndex: 0,
                        value: 1000,
                        sequence: 0xffffffff,
                        witnessUtxoScriptHex: '0014' + 'bb'.repeat(20),
                        nonWitnessUtxoHex: prevTxHex,
                        redeemScriptHex: null,
                    }],
                    outputs: [{ value: 900, scriptPubKeyHex: '0014' + 'cc'.repeat(20) }],
                    locktime: 0,
                }),
                txidOf: vi.fn().mockReturnValue('deadbeef'),
            },
        };
        const app = makeApp();
        const s = makeSigner(app, { sdkRegistry: { get: () => mockSdk } });
        await s.signPsbt({
            psbtHex: 'cafe',
            chainId: 'bitcoin-mainnet',
            signingPaths: [{ inputIndex: 0, path: "m/84'/0'/0'/0/0" }],
        });
        expect(app.splitTransaction).toHaveBeenCalledWith(prevTxHex, true, false, ['bech32']);
        expect(app.splitTransaction.mock.calls[0]).toHaveLength(4);
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
