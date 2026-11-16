// @vitest-environment node
// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import bitcoin from 'bitcoinjs-lib';
import { describe, expect, it, vi } from 'vitest';
import { encodeWif } from '../../../packages/core/src/crypto/wif.js';
import {
    gatedManifestActionData,
} from '../../../packages/core/src/flows/gatedMultipartManifest.js';
import { publishMultipartFile } from '../../../packages/core/src/flows/publishMultipartFile.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');
const formats = require('xchain-sdk/src/protocol/formats.js');
const MULTIPART_MANIFEST_FORMAT = [
    'VERSION', 'FILE_HASH', 'TOTAL_PARTS', 'TOTAL_BYTES', 'NAME', 'TYPE', 'TITLE',
    'MEMO', 'GATE_TICKER', 'ENCRYPTION_METHOD', 'KEY_HASH', 'GATE_MIN_AMOUNT',
    'COMPRESSION',
].join('|');
const realSdk = new XChainSDK({ network: 'bitcoin-regtest', preflight: false });
const PRIVATE_KEY = new Uint8Array(32).fill(1);
const WIF = encodeWif(PRIVATE_KEY, 0xef);
const PUBLIC_KEY = realSdk.wallet.importWIF(WIF).publicKeyHex;
const KEY = new Uint8Array(Array.from({ length: 32 }, (_value, index) => index + 1));
const KEY_HASH = createHash('sha256').update(KEY).digest('hex');
const FILE_HASH = 'ab'.repeat(32);
const ADDRESS = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(PUBLIC_KEY, 'hex'), network: bitcoin.networks.regtest,
}).address;

function manifest(overrides = {}) {
    return {
        fileHash: FILE_HASH, totalParts: 2, totalBytes: 4,
        name: 'private.bin', type: 'application/octet-stream', title: '', memo: '',
        gateTicker: 'GATE', encryptionMethod: '1', keyHash: KEY_HASH,
        gateMinAmount: '', compression: '', ...overrides,
    };
}

function txid(number) {
    return number.toString(16).padStart(2, '0').repeat(32);
}

function fakePlan(gate) {
    const parts = [Uint8Array.of(1, 2), Uint8Array.of(3, 4)];
    const keyHash = gate?.key
        ? createHash('sha256').update(gate.key).digest('hex')
        : '';
    return {
        parts: parts.map((rawData, partIndex) => ({
            partIndex, rawData, digest: String(partIndex + 1).repeat(64),
        })),
        fileHash: FILE_HASH, totalParts: 2, totalBytes: 4, compression: '',
        manifestParams: manifest({
            gateTicker: gate ? 'GATE' : '',
            encryptionMethod: gate ? '1' : '',
            keyHash,
        }),
    };
}

function memoryVault() {
    const rows = new Map();
    return {
        rows,
        pendingFileUploads: {
            put: vi.fn(async (record) => rows.set(record.id, structuredClone(record))),
            get: vi.fn(async (id) => rows.get(id)),
        },
    };
}

function harness() {
    let signedNumber = 0;
    let actionIndex = 40;
    const outputs = [0, 1, 2].map((vout) => ({
        vout, address: ADDRESS, value: 400, scriptPubKey: `script-${vout}`,
    }));
    const encoder = {
        createTx: vi.fn(async (opts) => opts.customOutputs ? {
            psbt: 'funding',
            outputs: opts.customOutputs.map((output, vout) => ({
                vout, ...output, scriptPubKey: `script-${vout}`,
            })),
        } : { psbt: 'commit', revealPsbt: 'reveal', encoding: 'TAPROOT' }),
        broadcastTx: vi.fn(async () => {}),
    };
    const sdk = {
        encoder,
        actions: { createAction: vi.fn((data) => ({ actionString: JSON.stringify(data) })) },
        wallet: { decomposePsbt: vi.fn(() => ({ inputs: [{}], outputs })) },
        gatedFile: { serializeKeyPayload: vi.fn(() => Buffer.from([1, ...KEY])) },
        messaging: { eciesEncryptBytes: vi.fn(() => ({ ciphertext: 'ciphertext' })) },
        waitForAction: vi.fn(async () => ({
            actions: [{ action: 'FILE', action_index: actionIndex++ }],
        })),
        getAction: vi.fn(async () => ({ data: [{ multipart: {
            file_hash: FILE_HASH, total_parts: 2, parts_received: 2,
            total_bytes: 4, status: 'complete',
        } }] })),
    };
    const signer = { signPsbt: vi.fn(async () => {
        signedNumber += 1;
        return { txid: txid(signedNumber), txHex: `${signedNumber}abc` };
    }) };
    return { encoder, sdk, signer, vault: memoryVault(), sdkRegistry: { get: () => sdk } };
}

function options(h, overrides = {}) {
    return {
        vault: h.vault, walletId: 'wallet-1', chainId: 'bitcoin-regtest',
        from: { address: ADDRESS, publicKey: PUBLIC_KEY, derivationPath: "m/84'/1'/0'/0/0" },
        bytes: Uint8Array.of(7, 8, 9),
        meta: { name: 'private.bin', type: 'application/octet-stream' },
        signer: h.signer, sdkRegistry: h.sdkRegistry,
        chainRegistry: { get: vi.fn(() => ({ coin: 'bitcoin', dustThreshold: 100 })) },
        lane: 'envelope', buildMode: 'one_call', rate: 1, outputFloor: 100,
        sizes: { envelopePairVbytes: () => 8 },
        planMultipartFile: vi.fn(async (_bytes, _meta, planOptions) => fakePlan(planOptions.gate)),
        waitForFunding: vi.fn(async () => {}), sleep: vi.fn(async () => {}),
        ...overrides,
    };
}

function createdActions(h) {
    return h.sdk.actions.createAction.mock.calls.map(([action]) => action);
}

function sdkActionString(action) {
    const previous = formats.FILE[1];
    formats.FILE[1] = MULTIPART_MANIFEST_FORMAT;
    try {
        return realSdk.actions.createAction(action).actionString;
    } finally {
        if (previous === undefined) delete formats.FILE[1];
        else formats.FILE[1] = previous;
    }
}

describe('gated manifest key handoff compatibility', () => {
    it('decrypts to version 1 and the key and emits the SDK BATCH wire', () => {
        const callback = gatedManifestActionData({
            sdk: realSdk, key: KEY, publicKey: PUBLIC_KEY,
            coin: 'BTC', sourceAddress: ADDRESS,
        });
        const action = callback(manifest());
        const actionString = sdkActionString(action);
        const ciphertext = action.params.COMMAND.split(`;MESSAGE|2|BTC|${ADDRESS}|`)[1];
        const { plaintext } = realSdk.messaging.eciesDecryptBytes(ciphertext, WIF);

        expect(plaintext).toEqual(Buffer.from([1, ...KEY]));
        expect(actionString).toMatch(new RegExp(`^BATCH\\|0\\|FILE\\|1\\|${FILE_HASH}\\|`));
        expect(actionString).toContain(`;MESSAGE|2|BTC|${ADDRESS}|`);
    });

    it('encrypts the handoff once when the callback is reused', () => {
        const sdk = {
            gatedFile: { serializeKeyPayload: vi.fn(() => Buffer.from([1, ...KEY])) },
            messaging: { eciesEncryptBytes: vi.fn(() => ({ ciphertext: 'ciphertext' })) },
        };
        const callback = gatedManifestActionData({
            sdk, key: KEY, publicKey: PUBLIC_KEY, coin: 'BTC', sourceAddress: ADDRESS,
        });
        callback(manifest());
        callback(manifest());
        expect(sdk.gatedFile.serializeKeyPayload).toHaveBeenCalledTimes(1);
        expect(sdk.messaging.eciesEncryptBytes).toHaveBeenCalledTimes(1);
    });
});

describe('gated manifest input refusals', () => {
    it.each([
        ['key type', { key: Array(32).fill(1) }],
        ['key length', { key: new Uint8Array(31) }],
        ['empty publicKey', { publicKey: '' }],
        ['non-hex publicKey', { publicKey: 'not-hex' }],
        ['empty coin', { coin: ' ' }],
        ['empty sourceAddress', { sourceAddress: '' }],
    ])('refuses an invalid %s', (_label, overrides) => {
        expect(() => gatedManifestActionData({
            sdk: realSdk, key: KEY, publicKey: PUBLIC_KEY,
            coin: 'BTC', sourceAddress: ADDRESS, ...overrides,
        })).toThrow(expect.objectContaining({ code: 'GATED_MANIFEST_INPUT_INVALID' }));
    });

    it('refuses a manifest whose keyHash does not match the key', () => {
        const callback = gatedManifestActionData({
            sdk: realSdk, key: KEY, publicKey: PUBLIC_KEY,
            coin: 'BTC', sourceAddress: ADDRESS,
        });
        expect(() => callback(manifest({ keyHash: 'ff'.repeat(32) })))
            .toThrow(expect.objectContaining({ code: 'GATED_MANIFEST_KEY_MISMATCH' }));
    });
});

describe('multipart publish manifest action selection', () => {
    it('builds a BATCH manifest and FILE version 2 parts for a gated upload', async () => {
        const h = harness();
        await publishMultipartFile(options(h, { gate: { key: KEY } }));
        const actions = createdActions(h);
        expect(actions.slice(0, 2)).toEqual([
            { action: 'FILE', params: { VERSION: '2', FILE_HASH, PART_INDEX: '0' } },
            { action: 'FILE', params: { VERSION: '2', FILE_HASH, PART_INDEX: '1' } },
        ]);
        expect(actions[2]).toMatchObject({ action: 'BATCH', params: { VERSION: '0' } });
        expect(actions[2].params.COMMAND).toContain(`;MESSAGE|2|BTC|${ADDRESS}|ciphertext`);
    });

    it('keeps an ungated manifest as a bare FILE version 1', async () => {
        const h = harness();
        await publishMultipartFile(options(h));
        expect(createdActions(h)[2]).toMatchObject({
            action: 'FILE', params: { VERSION: '1', FILE_HASH },
        });
        expect(h.sdk.messaging.eciesEncryptBytes).not.toHaveBeenCalled();
    });

    it('uses a caller-supplied manifest callback', async () => {
        const h = harness();
        const manifestActionData = vi.fn(() => ({
            action: 'BATCH', params: { VERSION: '0', COMMAND: 'caller' },
        }));
        await publishMultipartFile(options(h, { gate: { key: KEY }, manifestActionData }));
        expect(manifestActionData).toHaveBeenCalledOnce();
        expect(createdActions(h)[2].params.COMMAND).toBe('caller');
        expect(h.sdk.messaging.eciesEncryptBytes).not.toHaveBeenCalled();
    });
});

describe('multipart publish protocol coin refusal', () => {
    it('does not construct a transaction when the coin cannot be resolved', async () => {
        const h = harness();
        await expect(publishMultipartFile(options(h, {
            gate: { key: KEY },
            chainRegistry: { get: vi.fn(() => ({ coin: 'unknown' })) },
        }))).rejects.toThrow(/cannot resolve protocol coin ticker/);
        expect(h.encoder.createTx).not.toHaveBeenCalled();
        expect(h.vault.pendingFileUploads.put).not.toHaveBeenCalled();
    });
});
