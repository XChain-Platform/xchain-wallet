// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: TrezorSigner: all non-hardware-transport methods via a mocked Connect.

import { describe, it, expect, vi } from 'vitest';
import {
    TrezorSigner,
    deviceIdentifierFromFeatures,
    modelFromFeatures,
    firmwareVersionFromFeatures,
    coinTypeFor,
} from '../../../packages/signers-trezor/src/TrezorSigner.js';
import { Signer } from '../../../packages/core/src/signers/Signer.js';
import { BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/descriptors/index.js';

// coinTypeFor's SLIP-44 slots (btc=0', ltc=2', doge=3') are a second,
// independently-hardcoded copy of the same coin-type the chain descriptors'
// derivationPaths declare. The two agree today, but nothing guards against a
// future descriptor edit silently diverging hardware from software derivation
// for the same account (uuid 980fe12c). This test locks the two together.
const TREZOR_COIN_TO_MAINNET_DESCRIPTOR_ID = {
    btc: 'bitcoin-mainnet',
    ltc: 'litecoin-mainnet',
    doge: 'dogecoin-mainnet',
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
    Object.entries(TREZOR_COIN_TO_MAINNET_DESCRIPTOR_ID).forEach(([trezorCoin, descriptorId]) => {
        it(`${trezorCoin}: coinTypeFor matches the ${descriptorId} descriptor's coin-type slot`, () => {
            expect(coinTypeFor(trezorCoin)).toBe(descriptorCoinType(descriptorId));
        });
    });
});

function makeConnect(overrides = {}) {
    return {
        getFeatures: vi.fn().mockResolvedValue({
            success: true,
            payload: {
                device_id: 'DEVICE_ID_MOCK',
                internal_model: 'T2T1',
                major_version: 2,
                minor_version: 6,
                patch_version: 0,
            },
        }),
        getAddress: vi.fn().mockResolvedValue({
            success: true,
            payload: { address: 'bc1qmock' },
        }),
        getPublicKey: vi.fn().mockResolvedValue({
            success: true,
            payload: { publicKey: '02' + 'a'.repeat(64), chainCode: 'c'.repeat(64), fingerprint: '12345678' },
        }),
        signTransaction: vi.fn().mockResolvedValue({
            success: true,
            payload: { serializedTx: 'deadbeef' },
        }),
        signMessage: vi.fn().mockResolvedValue({
            success: true,
            payload: { signature: 'base64sigreturned' },
        }),
        ...overrides,
    };
}

function makeSigner(connectOverrides = {}, opts = {}) {
    return new TrezorSigner({
        id: 'trezor-test',
        displayName: 'Trezor (T2T1)',
        model: 'T2T1',
        deviceIdentifier: 'DEVICE_ID_MOCK',
        connect: makeConnect(connectOverrides),
        ...opts,
    });
}

describe('TrezorSigner constructor', () => {
    it('extends Signer', () => {
        expect(makeSigner()).toBeInstanceOf(Signer);
    });

    it('exposes id, displayName, kind, model, deviceIdentifier', () => {
        const s = makeSigner();
        expect(s.id).toBe('trezor-test');
        expect(s.displayName).toBe('Trezor (T2T1)');
        expect(s.kind).toBe('trezor');
        expect(s.model).toBe('T2T1');
        expect(s.deviceIdentifier).toBe('DEVICE_ID_MOCK');
    });

    it('requiresPhysicalConfirmation is true', () => {
        expect(makeSigner().requiresPhysicalConfirmation).toBe(true);
    });

    it('throws when id is missing', () => {
        expect(() => new TrezorSigner({ id: '', displayName: 'X', model: 'T2T1', deviceIdentifier: 'x', connect: makeConnect() }))
            .toThrow(/id is required/);
    });

    it('throws when connect is null', () => {
        expect(() => new TrezorSigner({ id: 'x', displayName: 'X', model: 'T2T1', deviceIdentifier: 'x', connect: null }))
            .toThrow(/connect is required/);
    });
});

describe('TrezorSigner.getStatus', () => {
    it('returns "available" when device matches', async () => {
        const s = makeSigner();
        expect(await s.getStatus()).toBe('available');
    });

    it('returns "disconnected" when getFeatures throws', async () => {
        const s = makeSigner({ getFeatures: vi.fn().mockRejectedValue(new Error('disconnected')) });
        expect(await s.getStatus()).toBe('disconnected');
    });

    it('returns "disconnected" when getFeatures returns failure', async () => {
        const s = makeSigner({ getFeatures: vi.fn().mockResolvedValue({ success: false }) });
        expect(await s.getStatus()).toBe('disconnected');
    });

    it('returns "disconnected" when a different device is attached', async () => {
        const s = makeSigner({
            getFeatures: vi.fn().mockResolvedValue({
                success: true,
                payload: { device_id: 'OTHER_DEVICE', internal_model: 'T2T1' },
            }),
        });
        expect(await s.getStatus()).toBe('disconnected');
    });

    it('returns "disconnected" when device_id is absent (identity unconfirmable, fail closed)', async () => {
        // When the observed device reports neither device_id nor
        // fw_fingerprint we cannot confirm it is the device we paired
        // with, so fail closed to 'disconnected' rather than asserting the
        // paired device is present (which would silently accept a swapped
        // or counterfeit device that omits both id fields).
        const s = makeSigner({
            getFeatures: vi.fn().mockResolvedValue({ success: true, payload: { internal_model: 'T2T1' } }),
        });
        expect(await s.getStatus()).toBe('disconnected');
    });
});

describe('TrezorSigner.getAddresses', () => {
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

    it('throws when getAddress call fails', async () => {
        const s = makeSigner({
            getAddress: vi.fn().mockResolvedValue({ success: false, payload: { error: 'User rejected' } }),
        });
        await expect(s.getAddresses({
            chainId: 'bitcoin-mainnet',
            accountIndex: 0,
            change: 0,
            startIndex: 0,
            count: 1,
            addressType: 'p2wpkh',
        })).rejects.toThrow(/getAddress failed/);
    });

    it('throws when getPublicKey call fails', async () => {
        const s = makeSigner({
            getPublicKey: vi.fn().mockResolvedValue({ success: false, payload: { error: 'PK error' } }),
        });
        await expect(s.getAddresses({
            chainId: 'bitcoin-mainnet',
            accountIndex: 0,
            change: 0,
            startIndex: 0,
            count: 1,
        })).rejects.toThrow(/getPublicKey failed/);
    });

    it('uses 44 purpose for dogecoin', async () => {
        const s = makeSigner();
        const rows = await s.getAddresses({
            chainId: 'dogecoin-mainnet',
            accountIndex: 0,
            change: 0,
            startIndex: 0,
            count: 1,
        });
        expect(rows[0].path).toMatch(/^m\/44'/);
    });

    it('§17.6: passes showOnTrezor per the verify flag (device confirmation)', async () => {
        const getAddress = vi.fn().mockResolvedValue({ success: true, payload: { address: 'bc1qmock' } });
        const s = makeSigner({ getAddress });
        const params = {
            chainId: 'bitcoin-mainnet', accountIndex: 0, change: 0, startIndex: 0, count: 1, addressType: 'p2wpkh',
        };
        await s.getAddresses(params);
        expect(getAddress.mock.calls[0][0]).toMatchObject({ showOnTrezor: false });
        getAddress.mockClear();
        await s.getAddresses({ ...params, verify: true });
        expect(getAddress.mock.calls[0][0]).toMatchObject({ showOnTrezor: true });
    });
});

describe('TrezorSigner.getPublicKey', () => {
    it('returns publicKey, chainCode, fingerprint', async () => {
        const s = makeSigner();
        const out = await s.getPublicKey({ chainId: 'bitcoin-mainnet', path: "m/84'/0'/0'" });
        expect(out.publicKey).toBe('02' + 'a'.repeat(64));
        expect(out.chainCode).toBe('c'.repeat(64));
        expect(out.fingerprint).toBe('12345678');
    });

    it('throws on failure', async () => {
        const s = makeSigner({ getPublicKey: vi.fn().mockResolvedValue({ success: false, error: { error: 'pk fail' } }) });
        await expect(s.getPublicKey({ chainId: 'bitcoin-mainnet', path: "m/84'/0'/0'" }))
            .rejects.toThrow(/getPublicKey failed/);
    });
});

describe('TrezorSigner.signMessage', () => {
    it('returns the signature from Connect', async () => {
        const s = makeSigner();
        const out = await s.signMessage({ message: 'hello', chainId: 'bitcoin-mainnet', path: "m/84'/0'/0'/0/0" });
        expect(out.signature).toBe('base64sigreturned');
    });

    it('throws when message is not a string', async () => {
        const s = makeSigner();
        await expect(s.signMessage({ message: null, chainId: 'bitcoin-mainnet', path: "m/84'/0'/0'/0/0" }))
            .rejects.toThrow(/message is required/);
    });

    it('throws when path does not start with m/', async () => {
        const s = makeSigner();
        await expect(s.signMessage({ message: 'hi', chainId: 'bitcoin-mainnet', path: '84/0/0' }))
            .rejects.toThrow(/path is required/);
    });

    it('throws when Connect returns empty signature', async () => {
        const s = makeSigner({ signMessage: vi.fn().mockResolvedValue({ success: true, payload: { signature: '' } }) });
        await expect(s.signMessage({ message: 'hi', chainId: 'bitcoin-mainnet', path: "m/84'/0'/0'/0/0" }))
            .rejects.toThrow(/no signature/);
    });

    it('throws when signMessage call fails', async () => {
        const s = makeSigner({ signMessage: vi.fn().mockResolvedValue({ success: false, payload: { error: 'denied' } }) });
        await expect(s.signMessage({ message: 'hi', chainId: 'bitcoin-mainnet', path: "m/84'/0'/0'/0/0" }))
            .rejects.toThrow(/signMessage failed/);
    });
});

describe('TrezorSigner.signPsbt', () => {
    it('throws without sdkRegistry', async () => {
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

describe('TrezorSigner multisig stubs', () => {
    // The message is what the sign screen renders directly (user-facing-
    // language: no Class.method: developer breadcrumb, no raw "MuSig2"/
    // "cosigner" jargon repeated). err.code carries the typed identifier
    // for callers that want to branch, and the qualified technical string
    // survives as err.cause for logs.
    it('signMusig2Round1 throws a plain-language hardware-unsupported error', async () => {
        await expect(makeSigner().signMusig2Round1()).rejects.toMatchObject({
            code: 'HW_MUSIG2_UNSUPPORTED',
            cause: expect.stringMatching(/^TrezorSigner\.signMusig2Round1:/),
        });
        await expect(makeSigner().signMusig2Round1())
            .rejects.not.toThrow(/TrezorSigner\.signMusig2Round1:/);
    });

    it('signMusig2Round2 throws a plain-language hardware-unsupported error', async () => {
        await expect(makeSigner().signMusig2Round2()).rejects.toMatchObject({
            code: 'HW_MUSIG2_UNSUPPORTED',
            cause: expect.stringMatching(/^TrezorSigner\.signMusig2Round2:/),
        });
        await expect(makeSigner().signMusig2Round2())
            .rejects.not.toThrow(/TrezorSigner\.signMusig2Round2:/);
    });

    it('signMultisigClassical throws not-yet-wired', async () => {
        await expect(makeSigner().signMultisigClassical()).rejects.toThrow(/not yet wired/);
    });

    it('signMultisigPsbt throws not-wired', async () => {
        await expect(makeSigner().signMultisigPsbt()).rejects.toThrow(/not yet wired|not wired/i);
    });
});

describe('deviceIdentifierFromFeatures', () => {
    it('returns device_id when present', () => {
        expect(deviceIdentifierFromFeatures({ device_id: 'MYID', fw_fingerprint: 'FP' })).toBe('MYID');
    });

    it('falls back to fw_fingerprint', () => {
        expect(deviceIdentifierFromFeatures({ fw_fingerprint: 'FP' })).toBe('FP');
    });

    it('returns null when neither is present', () => {
        expect(deviceIdentifierFromFeatures({})).toBeNull();
    });

    it('returns null for non-object input', () => {
        expect(deviceIdentifierFromFeatures(null)).toBeNull();
        expect(deviceIdentifierFromFeatures('string')).toBeNull();
    });
});

describe('modelFromFeatures', () => {
    it('prefers internal_model', () => {
        expect(modelFromFeatures({ internal_model: 'T3T1', model: '1' })).toBe('T3T1');
    });

    it('maps legacy "1" to T1B1', () => {
        expect(modelFromFeatures({ model: '1' })).toBe('T1B1');
    });

    it('maps legacy "T" to T2T1', () => {
        expect(modelFromFeatures({ model: 'T' })).toBe('T2T1');
    });

    it('returns model as-is for unknown string', () => {
        expect(modelFromFeatures({ model: 'X999' })).toBe('X999');
    });

    it('returns null for missing model fields', () => {
        expect(modelFromFeatures({})).toBeNull();
    });

    it('returns null for non-object input', () => {
        expect(modelFromFeatures(null)).toBeNull();
    });
});

describe('firmwareVersionFromFeatures', () => {
    it('composes version string from major/minor/patch', () => {
        expect(firmwareVersionFromFeatures({ major_version: 2, minor_version: 6, patch_version: 1 })).toBe('2.6.1');
    });

    it('returns null when a version component is missing', () => {
        expect(firmwareVersionFromFeatures({ major_version: 2, minor_version: 6 })).toBeNull();
    });

    it('returns null for null/undefined input', () => {
        expect(firmwareVersionFromFeatures(null)).toBeNull();
        expect(firmwareVersionFromFeatures(undefined)).toBeNull();
    });
});
