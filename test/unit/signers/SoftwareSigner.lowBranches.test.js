// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import { SoftwareSigner } from '../../../packages/core/src/signers/SoftwareSigner.js';

const PATH = "m/84'/0'/0'/0/0";

function makeSigner({ chainRegistry, sdkRegistry, walletEncryption = {} } = {}) {
    const signer = new SoftwareSigner({
        id: 'software-1',
        displayName: 'Software wallet',
        chainRegistry: chainRegistry ?? { get: () => ({ wifVersionByte: 0x80 }) },
        walletEncryption,
        sdkRegistry: sdkRegistry ?? { get: () => ({}) },
    });
    signer._acceptUnlockedState({
        mnemonicBytes: new Uint8Array(0),
        seed: new Uint8Array(64),
        importedWifs: new Map(),
        masterKey: null,
    });
    return signer;
}

function sessionRef(overrides = {}) {
    return {
        scheme: 'taproot-musig2',
        cosignerPubkeys: ['02'.repeat(33), '03'.repeat(33)],
        msgHash: 'aa'.repeat(32),
        fingerprint: 'bb'.repeat(32),
        nonceUniqueId: 'session-1',
        ...overrides,
    };
}

describe('SoftwareSigner low-coverage branches', () => {
    it('returns a retained master key', () => {
        const signer = makeSigner();
        const masterKey = new Uint8Array(32).fill(7);
        signer._unlocked.masterKey = masterKey;

        expect(signer.getMasterKey()).toBe(masterKey);
    });

    it('uses default wallet and address formats when deriving an address', async () => {
        const derivationPathFor = vi.fn(() => PATH);
        const signer = makeSigner({
            chainRegistry: {
                get: () => ({ defaultAddressType: 'p2wpkh', addressTypes: ['p2wpkh'] }),
                derivationPathFor,
            },
            sdkRegistry: { get: () => ({ wallet: { deriveAddress: () => 'bc1qtest' } }) },
        });

        await expect(signer.getAddresses({
            chainId: 'bitcoin', accountIndex: 0, change: 0, startIndex: 0, count: 1,
        })).resolves.toEqual([expect.objectContaining({ address: 'bc1qtest', path: PATH })]);
        expect(derivationPathFor).toHaveBeenCalledWith(
            'bitcoin', 'p2wpkh', 0, 0, 0, { format: 'bip39' },
        );
    });

    it('validates chain, address type, and derivation-path availability', async () => {
        await expect(makeSigner({ chainRegistry: { get: () => null } }).getAddresses({
            chainId: 'missing', accountIndex: 0, change: 0, startIndex: 0, count: 1,
        })).rejects.toThrow('unknown chain');

        const descriptor = { defaultAddressType: 'p2wpkh', addressTypes: ['p2wpkh'] };
        await expect(makeSigner({ chainRegistry: { get: () => descriptor } }).getAddresses({
            chainId: 'bitcoin', accountIndex: 0, change: 0, startIndex: 0, count: 1,
            addressType: 'p2tr',
        })).rejects.toThrow('not supported');

        await expect(makeSigner({
            chainRegistry: { get: () => descriptor, derivationPathFor: () => null },
        }).getAddresses({
            chainId: 'bitcoin', accountIndex: 0, change: 0, startIndex: 0, count: 1,
        })).rejects.toThrow('no derivation path');
    });

    it('routes envelope reveals and tolerates a missing transaction id in logging', async () => {
        const signEnvelopeRevealPsbt = vi.fn(() => ({
            txHex: '00', psbtHex: '70736274ff', txid: undefined,
        }));
        const signer = makeSigner({
            sdkRegistry: { get: () => ({ wallet: { signEnvelopeRevealPsbt } }) },
        });
        signer._resolveWifForEntry = vi.fn(() => 'wif');

        await expect(signer.signPsbt({
            psbtHex: '70736274ff',
            chainId: 'bitcoin',
            signingPaths: [{ inputIndex: 0, path: PATH }],
            envelopeReveal: true,
        })).resolves.toEqual({ signedPsbtHex: '70736274ff', txHex: '00', txid: undefined });
        expect(signEnvelopeRevealPsbt).toHaveBeenCalledWith('70736274ff', 'wif');
    });

    it('accepts a string message signature and selects nested SegWit options', async () => {
        const signMessage = vi.fn(() => 'signature');
        const signer = makeSigner({ sdkRegistry: { get: () => ({ auth: { signMessage } }) } });
        signer._resolveWifForEntry = vi.fn(() => 'wif');

        await expect(signer.signMessage({
            message: 'hello', chainId: 'bitcoin', path: "m/49'/0'/0'/0/0",
        })).resolves.toEqual({ signature: 'signature' });
        expect(signMessage).toHaveBeenCalledWith(
            'hello', 'wif', { segwitRedeemScript: true },
        );
    });

    it('requires an SDK registry after unlock', async () => {
        const signer = makeSigner();
        signer._sdkRegistry = null;

        await expect(signer.getAddresses({})).rejects.toThrow('requires an sdkRegistry');
    });

    it.each([null, ''])('requires a non-empty chain id for WIF export %#', (chainId) => {
        expect(() => makeSigner().exportWifForPath({ chainId, path: PATH }))
            .toThrow('chainId is required');
    });

    it.each([null, ''])('requires a non-empty imported address id %#', (addressId) => {
        expect(() => makeSigner().exportWifForAddressId(addressId))
            .toThrow('addressId is required');
    });

    it('reports absent imported keys and malformed signing entries', () => {
        const signer = makeSigner();

        expect(() => signer.exportWifForAddressId('missing')).toThrow('no imported WIF');
        expect(() => signer._resolveWifForEntry('bitcoin', null)).toThrow('must supply either');
    });

    it('validates chain and path before deriving a WIF', () => {
        expect(() => makeSigner({ chainRegistry: { get: () => null } })
            ._deriveWifFor('missing', PATH)).toThrow('unknown chain');
        expect(() => makeSigner()._deriveWifFor('bitcoin', 'invalid'))
            .toThrow('invalid derivation path');
    });

    it.each([
        [null, 'sessionRef is required'],
        [{ scheme: 'unknown' }, 'scheme'],
        [{ scheme: 'taproot-musig2', cosignerPubkeys: [] }, 'cosignerPubkeys'],
        [{
            scheme: 'taproot-musig2', cosignerPubkeys: ['02', '03'], msgHash: 'zz',
        }, 'msgHash'],
        [{
            scheme: 'taproot-musig2', cosignerPubkeys: ['02', '03'], msgHash: 'aa'.repeat(32),
            fingerprint: 'zz',
        }, 'fingerprint'],
        [{
            scheme: 'taproot-musig2', cosignerPubkeys: ['02', '03'], msgHash: 'aa'.repeat(32),
            fingerprint: 'bb'.repeat(32), nonceUniqueId: '',
        }, 'nonceUniqueId'],
    ])('validates MuSig2 session input %#', async (ref, message) => {
        await expect(makeSigner().signMusig2Round1({
            chainId: 'bitcoin', path: PATH, sessionRef: ref,
        })).rejects.toThrow(message);
    });

    it('validates MuSig2 SDK support and derivation paths', async () => {
        await expect(makeSigner().signMusig2Round1({
            chainId: 'bitcoin', path: PATH, sessionRef: sessionRef(),
        })).rejects.toThrow('sdk.musig2 unavailable');

        await expect(makeSigner({
            sdkRegistry: { get: () => ({ musig2: {} }) },
        }).signMusig2Round1({
            chainId: 'bitcoin', path: 'invalid', sessionRef: sessionRef(),
        })).rejects.toThrow('invalid path');
    });

    it.each(['zz', 'aa'])('validates aggregate nonce %s', async (aggNonceHex) => {
        await expect(makeSigner().signMusig2Round2({
            chainId: 'bitcoin', path: PATH, sessionRef: sessionRef(), aggNonceHex,
        })).rejects.toThrow('aggNonceHex must be 66-byte hex');
    });

    it.each([
        [undefined],
        [{}],
        [{ wallet: {} }],
    ])('requires classical multisig SDK support %#', async (sdk) => {
        await expect(makeSigner({
            sdkRegistry: { get: () => sdk },
        }).signMultisigClassical({
            chainId: 'bitcoin', path: PATH, msgHash: 'aa'.repeat(32),
        })).rejects.toThrow('signEcdsa unavailable');
    });

    it('validates public-key derivation paths', async () => {
        await expect(makeSigner().getPublicKey({ path: 'invalid' })).rejects.toThrow('invalid path');
    });

    it('skips malformed imported-key records while unlocking a WIF-only wallet', async () => {
        const signer = new SoftwareSigner({
            id: 'software-1',
            displayName: 'Software wallet',
            chainRegistry: {},
            walletEncryption: { format: 'wif-only', importedKeys: [null, { addressId: 'bad' }] },
        });

        await signer.unlock({ password: 'pw', masterKey: new Uint8Array(32).fill(7) });

        await expect(signer.getStatus()).resolves.toBe('available');
        expect(signer._unlocked.importedWifs.size).toBe(0);
    });

    it('uses the empty imported-key fallback for a WIF-only wallet', async () => {
        const signer = new SoftwareSigner({
            id: 'software-1',
            displayName: 'Software wallet',
            chainRegistry: {},
            walletEncryption: { format: 'wif-only' },
        });

        await expect(signer.unlock({ password: 'pw' })).rejects.toThrow('has no importedKeys');
    });

    it('defaults a missing wallet format to BIP39 before decryption', async () => {
        const signer = new SoftwareSigner({
            id: 'software-1',
            displayName: 'Software wallet',
            chainRegistry: {},
            walletEncryption: { encryptedSeed: 'AA==' },
        });

        await expect(signer.unlock({
            password: 'pw', masterKey: new Uint8Array(32).fill(7),
        })).rejects.toThrow();
    });
});
