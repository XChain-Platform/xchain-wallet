// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit tests for gatedPublishAction (PC-25). The composition is the
// security-critical surface: the BATCH must bind the published
// ciphertext to sha256(K) via KEY_HASH, carry the self-addressed
// ECIES handoff in the SAME transaction, and K must be durably in the
// vault BEFORE anything can broadcast (an HW issuer can never recover
// K from the on-chain envelope).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'txid-1', actionString: 'BATCH|0|...' })),
}));
vi.mock('../../../packages/core/src/flows/buildActionPsbt.js', () => ({
    buildActionPsbt: vi.fn(async () => ({ psbtHex: 'deadbeef', encoding: 'p2wsh' })),
}));

import {
    gatedPublishAction,
    buildGatedPublishPsbtRequest,
    MAX_GATED_PLAINTEXT_BYTES,
} from '../../../packages/core/src/flows/gatedPublishAction.js';
import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { buildActionPsbt } from '../../../packages/core/src/flows/buildActionPsbt.js';

// --- Deterministic fake SDK crypto -----------------------------------
// Real shapes (Buffer in/out, hex hashes) with predictable contents so
// the BATCH string can be asserted byte-for-byte.
const FIXED_KEY = Buffer.alloc(32, 7);
const FIXED_KEY_HASH = 'a'.repeat(64);

function makeSdk() {
    return {
        gatedFile: {
            generateKey: vi.fn(() => ({ key: FIXED_KEY, keyHash: FIXED_KEY_HASH })),
            encryptWithKey: vi.fn((plaintext) => Buffer.concat([Buffer.from('IV__________TAG_____________'), Buffer.from(plaintext)])),
            serializeKeyPayload: vi.fn((keys) => Buffer.concat([Buffer.from([0x01]), ...keys])),
            verifyKey: vi.fn((key, hash) => key.equals(FIXED_KEY) && hash === FIXED_KEY_HASH),
        },
        messaging: {
            eciesEncryptBytes: vi.fn(() => ({ ciphertext: 'ec1e5c1pher' })),
        },
    };
}

function makeVault() {
    const store = new Map();
    return {
        store,
        gatedKeys: {
            get: vi.fn(async (id) => store.get(id) || null),
            put: vi.fn(async (record) => { store.set(record.id, record); }),
            list: vi.fn(async () => [...store.values()]),
        },
    };
}

function makeOpts(overrides = {}) {
    const sdk = overrides.sdk || makeSdk();
    return {
        vault: overrides.vault || makeVault(),
        walletId: 'w1',
        password: 'pw',
        chainRegistry: { get: () => ({ coin: 'bitcoin' }) },
        sdkRegistry: { get: () => sdk },
        chainId: 'btc-regtest',
        from: { address: 'bcrt1qissuer', publicKey: '02'.padEnd(66, 'ab'), derivationPath: "m/84'/1'/0'/0/0" },
        gateTicker: 'mytoken',
        name: 'album.zip',
        type: 'application/zip',
        title: 'Album',
        memo: '',
        plainData: 'PLAINTEXT-BYTES',
        sdk,
        ...overrides,
    };
}

beforeEach(() => {
    vi.mocked(submitAction).mockClear();
    vi.mocked(buildActionPsbt).mockClear();
});

describe('gatedPublishAction validation', () => {
    it('rejects missing gateTicker / name / type / plainData', async () => {
        await expect(gatedPublishAction(makeOpts({ gateTicker: '' }))).rejects.toThrow(/gateTicker is required/);
        await expect(gatedPublishAction(makeOpts({ name: '' }))).rejects.toThrow(/name is required/);
        await expect(gatedPublishAction(makeOpts({ type: '' }))).rejects.toThrow(/type \(MIME\)/);
        await expect(gatedPublishAction(makeOpts({ plainData: '' }))).rejects.toThrow(/plainData/);
    });

    it('rejects delimiter injection in every serialized text field', async () => {
        await expect(gatedPublishAction(makeOpts({ name: 'a|b' }))).rejects.toThrow(/cannot contain/);
        await expect(gatedPublishAction(makeOpts({ title: 'a;b' }))).rejects.toThrow(/cannot contain/);
        await expect(gatedPublishAction(makeOpts({ memo: 'a|b' }))).rejects.toThrow(/cannot contain/);
        await expect(gatedPublishAction(makeOpts({ gateTicker: 'TI|CK' }))).rejects.toThrow(/cannot contain/);
    });

    it('rejects plaintext past the lane cap', async () => {
        const big = 'x'.repeat(MAX_GATED_PLAINTEXT_BYTES + 1);
        await expect(gatedPublishAction(makeOpts({ plainData: big }))).rejects.toThrow(/supports up to/);
    });
});

describe('gatedPublishAction composition', () => {
    it('composes BATCH(FILE gated fields, MESSAGE v2 to self) with ciphertext as rawData', async () => {
        const opts = makeOpts();
        const result = await gatedPublishAction(opts);

        expect(result.keyHash).toBe(FIXED_KEY_HASH);
        const call = vi.mocked(submitAction).mock.calls[0][0];
        expect(call.actionData.action).toBe('BATCH');
        expect(call.actionData.params.VERSION).toBe('0');
        // Exact wire string: gate uppercased, ENCRYPTION_METHOD pinned to
        // 1, KEY_HASH from the generated key, MESSAGE addressed to SELF.
        expect(call.actionData.params.COMMAND).toBe(
            `FILE|0|album.zip|application/zip|Album||MYTOKEN|1|${FIXED_KEY_HASH}`
            + ';MESSAGE|2|BTC|bcrt1qissuer|ec1e5c1pher',
        );
        // rawData is the AES ciphertext, binary-string encoded.
        expect(call.encoderOpts.rawData).toBe(
            Buffer.concat([Buffer.from('IV__________TAG_____________'), Buffer.from('PLAINTEXT-BYTES')]).toString('binary'),
        );
        expect(call.encoderOpts.pubkey).toBe(opts.from.publicKey);
    });

    it('ECIES-encrypts the 0x01||K handoff to the ISSUER pubkey', async () => {
        const sdk = makeSdk();
        await gatedPublishAction(makeOpts({ sdk }));
        const [payload, pubkey] = sdk.messaging.eciesEncryptBytes.mock.calls[0];
        expect(payload).toEqual(Buffer.concat([Buffer.from([0x01]), FIXED_KEY]));
        expect(pubkey).toBe('02'.padEnd(66, 'ab'));
    });

    it('persists K to the vault BEFORE submitAction runs', async () => {
        const vault = makeVault();
        const order = [];
        vault.gatedKeys.put.mockImplementation(async (record) => {
            order.push('vault-put');
            vault.store.set(record.id, record);
        });
        vi.mocked(submitAction).mockImplementation(async () => {
            order.push('submit');
            return { txid: 't' };
        });
        await gatedPublishAction(makeOpts({ vault }));
        expect(order).toEqual(['vault-put', 'submit']);

        const [record] = [...vault.store.values()];
        expect(record).toMatchObject({
            walletId: 'w1',
            chainId: 'btc-regtest',
            gateTicker: 'MYTOKEN',
            keyHash: FIXED_KEY_HASH,
            keyHex: FIXED_KEY.toString('hex'),
            source: 'published',
        });
    });

    it('reuses the stored pack key for existingKeyHash and never regenerates', async () => {
        const sdk = makeSdk();
        const vault = makeVault();
        vault.store.set(`w1::btc-regtest::MYTOKEN::${FIXED_KEY_HASH}`, {
            id: `w1::btc-regtest::MYTOKEN::${FIXED_KEY_HASH}`,
            walletId: 'w1',
            chainId: 'btc-regtest',
            gateTicker: 'MYTOKEN',
            keyHash: FIXED_KEY_HASH,
            keyHex: FIXED_KEY.toString('hex'),
            source: 'published',
        });
        const result = await gatedPublishAction(makeOpts({ sdk, vault, existingKeyHash: FIXED_KEY_HASH }));
        expect(result.keyHash).toBe(FIXED_KEY_HASH);
        expect(sdk.gatedFile.generateKey).not.toHaveBeenCalled();
        expect(sdk.gatedFile.encryptWithKey.mock.calls[0][1]).toEqual(FIXED_KEY);
    });

    it('refuses existingKeyHash with no stored key (pack extension needs the vault key)', async () => {
        await expect(gatedPublishAction(makeOpts({ existingKeyHash: 'b'.repeat(64) })))
            .rejects.toThrow(/no stored key for pack/);
        expect(vi.mocked(submitAction)).not.toHaveBeenCalled();
    });

    it('refuses a stored key that fails its hash re-check', async () => {
        const sdk = makeSdk();
        sdk.gatedFile.verifyKey.mockReturnValue(false);
        const vault = makeVault();
        vault.store.set(`w1::btc-regtest::MYTOKEN::${FIXED_KEY_HASH}`, {
            id: `w1::btc-regtest::MYTOKEN::${FIXED_KEY_HASH}`,
            keyHex: FIXED_KEY.toString('hex'),
            keyHash: FIXED_KEY_HASH,
        });
        await expect(gatedPublishAction(makeOpts({ sdk, vault, existingKeyHash: FIXED_KEY_HASH })))
            .rejects.toThrow(/fails its hash check/);
        expect(vi.mocked(submitAction)).not.toHaveBeenCalled();
    });
});

describe('buildGatedPublishPsbtRequest (watcher path)', () => {
    it('runs the same composition and returns the PSBT request + keyHash', async () => {
        const vault = makeVault();
        const result = await buildGatedPublishPsbtRequest(makeOpts({ vault }));
        expect(result.psbtHex).toBe('deadbeef');
        expect(result.keyHash).toBe(FIXED_KEY_HASH);
        // K persisted on the encode-only path too: the watcher wallet owns
        // the pack; the paired signer only signs.
        expect(vault.gatedKeys.put).toHaveBeenCalledOnce();
        const call = vi.mocked(buildActionPsbt).mock.calls[0][0];
        expect(call.actionData.action).toBe('BATCH');
        expect(call.actionData.params.COMMAND).toMatch(/^FILE\|0\|.*;MESSAGE\|2\|BTC\|/);
        expect(vi.mocked(submitAction)).not.toHaveBeenCalled();
    });
});
