// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'txid-1' })),
}));
vi.mock('../../../packages/core/src/flows/composeActionForConfirm.js', () => ({
    composeActionForConfirm: vi.fn(async () => ({
        psbt: 'confirm-psbt', encoding: 'P2WSH', actionString: 'BATCH|0', version: '0',
    })),
}));

import {
    composeGatedPublishForConfirm,
    gatedPublishAction,
} from '../../../packages/core/src/flows/gatedPublishAction.js';
import { submitAction } from '../../../packages/core/src/flows/submitAction.js';

const KEY = Buffer.alloc(32, 7);
const KEY_HASH = 'a'.repeat(64);

function makeVault() {
    const store = new Map();
    return {
        store,
        gatedKeys: {
            get: vi.fn(async (id) => store.get(id) || null),
            put: vi.fn(async (record) => { store.set(record.id, record); }),
        },
    };
}

function makeOpts(vault) {
    const sdk = {
        gatedFile: {
            generateKey: vi.fn(() => ({ key: KEY, keyHash: KEY_HASH })),
            encryptWithKey: vi.fn((plaintext) => Buffer.from(plaintext)),
            serializeKeyPayload: vi.fn((keys) => Buffer.concat([Buffer.from([1]), ...keys])),
        },
        messaging: { eciesEncryptBytes: vi.fn(() => ({ ciphertext: 'handoff' })) },
    };
    return {
        vault,
        walletId: 'wallet-1',
        password: 'secret',
        chainRegistry: { get: () => ({ coin: 'bitcoin' }) },
        sdkRegistry: { get: () => sdk },
        chainId: 'bitcoin-mainnet',
        from: {
            id: 'address-1', address: 'bc1qsource', publicKey: '02'.padEnd(66, 'a'),
            derivationPath: "m/84'/0'/0'/0/0",
        },
        gateTicker: 'GATE',
        name: 'file.txt',
        type: 'text/plain',
        plainData: 'content',
    };
}

beforeEach(() => {
    vi.mocked(submitAction).mockReset();
    vi.mocked(submitAction).mockResolvedValue({ txid: 'txid-1' });
});

describe('gated publish key persistence', () => {
    it('does not save a generated pack key during confirmation compose', async () => {
        const vault = makeVault();

        await composeGatedPublishForConfirm(makeOpts(vault));

        expect(vault.gatedKeys.put).not.toHaveBeenCalled();
    });

    it('does not save a generated pack key when submission fails', async () => {
        const vault = makeVault();
        vi.mocked(submitAction).mockRejectedValueOnce(new Error('broadcast failed'));

        await expect(gatedPublishAction(makeOpts(vault))).rejects.toThrow('broadcast failed');

        expect(vault.gatedKeys.put).not.toHaveBeenCalled();
    });

    it('saves the generated pack key after a successful prebuilt submission', async () => {
        const vault = makeVault();
        const opts = makeOpts(vault);
        const composed = await composeGatedPublishForConfirm(opts);
        const prepared = composed.gatedPublish;

        await gatedPublishAction({
            ...opts,
            prebuiltPsbt: { psbtHex: composed.psbt, encoding: composed.encoding },
            prebuiltActionData: prepared.actionData,
            prebuiltKeyHash: prepared.keyHash,
            prebuiltCiphertextLength: prepared.ciphertextLength,
        });

        expect(submitAction).toHaveBeenCalledOnce();
        expect(vault.gatedKeys.put).toHaveBeenCalledOnce();
        expect([...vault.store.values()][0]).toMatchObject({
            walletId: 'wallet-1',
            keyHash: KEY_HASH,
            keyHex: KEY.toString('hex'),
            source: 'published',
        });
    });
});
