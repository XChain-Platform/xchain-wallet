// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async (input) => input),
}));
vi.mock('../../../packages/core/src/flows/sendToken.js', () => ({
    normalizeSource: vi.fn((from) => ({
        address: from.address,
        publicKey: from.publicKey,
        derivationPath: from.derivationPath || null,
        addressId: from.addressId || from.id || null,
    })),
}));
vi.mock('../../../packages/core/src/flows/exportPrivateKey.js', () => ({
    exportPrivateKey: vi.fn(async () => ({ wif: 'exported-wif' })),
}));

import { exportPrivateKey } from '../../../packages/core/src/flows/exportPrivateKey.js';
import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import {
    buildHandshakeActionData,
    buildMessageParams,
    getRecipientPubkey,
    handshakeAction,
    messageAction,
    PubkeyMismatchError,
    PubkeyNotFoundError,
    recipientPubkeyMatchesAddress,
} from '../../../packages/core/src/flows/messageAction.js';

const PUBKEY = `02${'ab'.repeat(32)}`;
const SOURCE = {
    id: 'address-id',
    address: 'source-address',
    publicKey: `03${'cd'.repeat(32)}`,
    derivationPath: "m/84'/1'/0'/0/0",
};

function setup(extra = {}) {
    const descriptor = extra.descriptor || { coin: 'bitcoin', addressTypes: ['p2wpkh'] };
    const sdk = {
        getPublicKey: vi.fn(async () => PUBKEY),
        wallet: { deriveAddress: vi.fn(() => 'destination') },
        messaging: {
            eciesEncrypt: vi.fn(() => ({ ciphertext: 'ecies-ciphertext' })),
            deriveSharedSecret: vi.fn(() => ({ sharedSecret: 'shared' })),
            sessionEncrypt: vi.fn(() => ({ ciphertext: 'session-ciphertext' })),
        },
        ...extra.sdk,
    };
    const chainRegistry = {
        get: vi.fn((chainId) => (chainId === 'missing' ? null : descriptor)),
    };
    const sdkRegistry = { get: vi.fn(() => sdk) };
    return {
        sdk,
        opts: {
            vault: {}, walletId: 'wallet', password: 'password',
            chainRegistry, sdkRegistry, chainId: 'destination-chain',
            from: SOURCE, destination: 'destination', message: 'hello',
            ...extra.opts,
        },
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('message parameter branches', () => {
    it('validates top-level message input', async () => {
        await expect(buildMessageParams()).rejects.toThrow('opts is required');
        await expect(buildMessageParams({ destination: '', message: 'hello' }))
            .rejects.toThrow('destination is required');
        await expect(buildMessageParams({ destination: 'destination', message: '' }))
            .rejects.toThrow('message is required');
    });

    it.each([
        ['NUL', 'pay\u0000recipient'],
        ['bidi override', 'pay\u202Erecipient'],
        ['zero-width joiner', 'pay\u200Drecipient'],
    ])('rejects a message containing an unsafe %s character', async (_label, message) => {
        const { opts, sdk } = setup({ opts: { message } });

        await expect(buildMessageParams(opts)).rejects.toThrow(/unsupported control or invisible characters/i);
        expect(sdk.messaging.eciesEncrypt).not.toHaveBeenCalled();
    });

    it('rejects unknown destination, coin, and broadcast chains', async () => {
        const missing = setup({ opts: { chainId: 'missing' } });
        await expect(buildMessageParams(missing.opts)).rejects.toThrow('unknown chain');

        const unknownCoin = setup({ descriptor: { coin: 'unknown' } });
        await expect(buildMessageParams(unknownCoin.opts)).rejects.toThrow('no protocol coin ticker');

        const missingBroadcast = setup({ opts: { broadcastChainId: 'missing' } });
        await expect(buildMessageParams(missingBroadcast.opts)).rejects.toThrow('unknown broadcast chain');
    });

    it('builds plaintext without resolving a recipient key', async () => {
        const { sdk, opts } = setup({ opts: { method: null } });
        await expect(buildMessageParams(opts)).resolves.toMatchObject({
            method: null,
            broadcastChainId: 'destination-chain',
            params: {
                VERSION: '3', COIN: 'BTC', DESTINATION: 'destination',
                PLAINTEXT_MESSAGE: 'hello',
            },
        });
        expect(sdk.getPublicKey).not.toHaveBeenCalled();
    });

    it('builds ECIES and defaults unknown methods to ECIES', async () => {
        const { sdk, opts } = setup({ opts: { method: 99 } });
        await expect(buildMessageParams(opts)).resolves.toMatchObject({
            method: 1,
            params: { VERSION: '2', ENCRYPTED_MESSAGE: 'ecies-ciphertext' },
        });
        expect(sdk.messaging.eciesEncrypt).toHaveBeenCalledWith('hello', PUBKEY);
    });

    it('rejects absent and mismatched recipient keys', async () => {
        const absent = setup({ sdk: { getPublicKey: vi.fn(async () => null) } });
        await expect(buildMessageParams(absent.opts)).rejects.toBeInstanceOf(PubkeyNotFoundError);

        const mismatch = setup({
            sdk: { wallet: { deriveAddress: vi.fn(() => 'different') } },
        });
        await expect(buildMessageParams(mismatch.opts)).rejects.toBeInstanceOf(PubkeyMismatchError);
    });

    it('builds ECDH with signer path and signer address fallbacks', async () => {
        const pathSigner = {
            exportWifForPath: vi.fn(async () => 'path-wif'),
            exportWifForAddressId: vi.fn(async () => 'id-wif'),
        };
        const pathCase = setup({ opts: { method: 2, signer: pathSigner } });
        await expect(buildMessageParams(pathCase.opts)).resolves.toMatchObject({
            method: 2,
            params: { ENCRYPTED_MESSAGE: 'session-ciphertext' },
        });
        expect(pathSigner.exportWifForPath).toHaveBeenCalledWith({
            chainId: 'destination-chain', path: SOURCE.derivationPath,
        });

        const idSigner = {
            exportWifForPath: vi.fn(async () => 'path-wif'),
            exportWifForAddressId: vi.fn(async () => 'id-wif'),
        };
        const idCase = setup({
            opts: { method: 2, signer: idSigner, from: { ...SOURCE, derivationPath: null } },
        });
        await buildMessageParams(idCase.opts);
        expect(idSigner.exportWifForAddressId).toHaveBeenCalledWith('address-id');
    });

    it('rejects hardware ECDH and exports a software key by address id', async () => {
        const hardware = setup({ opts: { method: 2, signer: {} } });
        await expect(buildMessageParams(hardware.opts)).rejects.toThrow('hardware wallet');

        const software = setup({
            opts: { method: 2, from: { ...SOURCE, derivationPath: null } },
        });
        await buildMessageParams(software.opts);
        expect(exportPrivateKey).toHaveBeenCalledWith(expect.objectContaining({ addressId: 'address-id' }));

        const noId = setup({
            opts: {
                method: 2,
                from: { address: SOURCE.address, publicKey: SOURCE.publicKey },
            },
        });
        await expect(buildMessageParams(noId.opts)).rejects.toThrow('needs an addressId');
    });
});

describe('recipient key binding branches', () => {
    it('rejects malformed keys and permits unverifiable keys', () => {
        expect(recipientPubkeyMatchesAddress({}, null, 'destination', {})).toBe(false);
        expect(recipientPubkeyMatchesAddress({}, 'zz', 'destination', {})).toBe(false);
        expect(recipientPubkeyMatchesAddress({}, 'ab', 'destination', {})).toBe(true);
        expect(recipientPubkeyMatchesAddress({}, PUBKEY, 'destination', {})).toBe(true);
    });

    it('uses default types and permits networks where every derivation throws', () => {
        const deriveAddress = vi.fn(() => { throw new Error('unsupported'); });
        expect(recipientPubkeyMatchesAddress(
            { wallet: { deriveAddress } }, PUBKEY, 'destination', {},
        )).toBe(true);
        expect(deriveAddress).toHaveBeenCalledTimes(3);
    });
});

describe('message submission branches', () => {
    it('uses prebuilt params, address-id signing, and disables pending tracking', async () => {
        const { opts } = setup({
            opts: {
                from: { ...SOURCE, derivationPath: null },
                prebuiltParams: { VERSION: '3', COIN: 'BTC', PLAINTEXT_MESSAGE: 'hello' },
                trackPendingTx: false,
                fee: 1,
                feePerKb: 2,
                rbf: false,
            },
        });
        const submitted = await messageAction(opts);
        expect(submitted).toMatchObject({
            chainId: 'destination-chain',
            pendingTxMeta: undefined,
            actionData: { params: opts.prebuiltParams },
            encoderOpts: { fee: 1, feePerKb: 2, rbf: false },
            signingPaths: [{ inputIndex: 0, addressId: 'address-id' }],
        });
    });

    it('describes encrypted pending sends and defaults to a derivation path', async () => {
        const { opts } = setup({
            opts: { prebuiltParams: { VERSION: '2', COIN: 'BTC', ENCRYPTED_MESSAGE: 'abcd' } },
        });
        const submitted = await messageAction(opts);
        expect(submitted.pendingTxMeta.actionSummary).toContain('encrypted');
        expect(submitted.signingPaths).toEqual([{ inputIndex: 0, path: SOURCE.derivationPath }]);
    });

    it('requires message action options', async () => {
        await expect(messageAction()).rejects.toThrow('opts is required');
    });
});

describe('handshake and recipient query branches', () => {
    it('validates handshake input and defaults request version', () => {
        expect(() => buildHandshakeActionData()).toThrow('opts is required');
        expect(() => buildHandshakeActionData({ destination: '' })).toThrow('destination is required');
        const unknown = setup({ opts: { chainId: 'missing' } });
        expect(() => buildHandshakeActionData(unknown.opts)).toThrow('unknown chain');
        const coin = setup({ descriptor: { coin: 'unknown' } });
        expect(() => buildHandshakeActionData(coin.opts)).toThrow('no protocol coin ticker');

        const { opts } = setup();
        expect(buildHandshakeActionData(opts)).toMatchObject({
            version: 0,
            actionData: { params: { VERSION: '0' } },
        });
    });

    it('submits response handshakes without pending metadata', async () => {
        const { opts } = setup({
            opts: { version: 1, trackPendingTx: false, from: { ...SOURCE, derivationPath: null } },
        });
        await handshakeAction(opts);
        expect(submitAction).toHaveBeenCalledWith(expect.objectContaining({
            pendingTxMeta: undefined,
            signingPaths: [{ inputIndex: 0, addressId: 'address-id' }],
        }));
    });

    it('validates and forwards recipient pubkey queries', async () => {
        await expect(getRecipientPubkey({ chainId: 'chain', address: 'address' }))
            .rejects.toThrow('sdkRegistry is required');
        await expect(getRecipientPubkey({ sdkRegistry: {}, address: 'address' }))
            .rejects.toThrow('chainId is required');
        await expect(getRecipientPubkey({ sdkRegistry: {}, chainId: 'chain', address: '' }))
            .rejects.toThrow('address is required');
        const sdk = { getPublicKey: vi.fn(async () => PUBKEY) };
        await expect(getRecipientPubkey({
            sdkRegistry: { get: () => sdk }, chainId: 'chain', address: 'address',
        })).resolves.toBe(PUBKEY);
        expect(sdk.getPublicKey).toHaveBeenCalledWith('address');
    });

    it('reads an explorer 404 as no key yet and still throws every other failure', async () => {
        const lookup = (err) => getRecipientPubkey({
            sdkRegistry: { get: () => ({ getPublicKey: vi.fn(async () => { throw err; }) }) },
            chainId: 'chain',
            address: 'address',
        });
        await expect(lookup(Object.assign(new Error('HTTP 404'), { code: 'EXPLORER_HTTP_404' })))
            .resolves.toBeNull();
        await expect(lookup(Object.assign(new Error('HTTP 404'), { details: { status: 404 } })))
            .resolves.toBeNull();
        await expect(lookup(Object.assign(new Error('HTTP 500'), { code: 'EXPLORER_HTTP_500' })))
            .rejects.toThrow('HTTP 500');
    });
});
