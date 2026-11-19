// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
    recordGateOf,
    resumeGateOf,
} from '../../../packages/core/src/flows/gatedUploadGate.js';
import { publishMultipartFile } from '../../../packages/core/src/flows/publishMultipartFile.js';
import { createPendingFileUpload } from '../../../packages/core/src/schemas/pendingFileUpload.js';

const SOURCE = {
    address: 'bcrt1qsource',
    publicKey: `02${'ab'.repeat(32)}`,
    derivationPath: "m/84'/1'/0'/0/0",
};
const BYTES = Uint8Array.of(7, 8, 9);
const KEY = new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1));
const OTHER_KEY = new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 2));
const IV = 'a9'.repeat(12);
const DIGESTS = ['11'.repeat(32), '22'.repeat(32)];

function digest(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}

function fileHash(key, iv) {
    return createHash('sha256').update(key).update(iv).digest('hex');
}

function fakePlan(gate = null) {
    const gated = gate?.key instanceof Uint8Array;
    const gateIv = gated ? (gate.iv ?? IV) : null;
    const keyHash = gated ? digest(gate.key) : '';
    const hash = gated ? fileHash(gate.key, gateIv) : 'cd'.repeat(32);
    return {
        parts: [Uint8Array.of(1, 2), Uint8Array.of(3, 4)].map((rawData, partIndex) => ({
            partIndex, rawData, digest: DIGESTS[partIndex],
        })),
        fileHash: hash,
        totalParts: 2,
        totalBytes: 4,
        compression: '',
        key: gated ? new Uint8Array(gate.key) : null,
        keyHash,
        gateIv,
        manifestParams: {
            fileHash: hash, totalParts: 2, totalBytes: 4,
            name: 'art.bin', type: 'application/octet-stream', title: '', memo: '',
            gateTicker: gated ? gate.ticker : '', encryptionMethod: gated ? 1 : '',
            keyHash, gateMinAmount: gated ? gate.minAmount : '', compression: '',
        },
    };
}

function memoryVault(seed = null) {
    const rows = new Map(seed ? [[seed.id, structuredClone(seed)]] : []);
    return {
        rows,
        pendingFileUploads: {
            put: vi.fn(async (record) => rows.set(record.id, structuredClone(record))),
            get: vi.fn(async (id) => rows.get(id) ? structuredClone(rows.get(id)) : null),
        },
    };
}

function txid(number) {
    return number.toString(16).padStart(2, '0').repeat(32);
}

function harness(seed = null) {
    let signedNumber = 0;
    let actionIndex = 40;
    const outputs = [0, 1, 2].map((vout) => ({
        vout, address: SOURCE.address, value: 400, scriptPubKey: `script-${vout}`,
    }));
    const encoder = {
        createTx: vi.fn(async (opts) => opts.customOutputs
            ? { psbt: 'funding-psbt', outputs }
            : { psbt: 'commit', revealPsbt: 'reveal', encoding: 'TAPROOT' }),
        broadcastTx: vi.fn(async () => {}),
        getTxBlock: vi.fn(async () => ({ block_height: 12 })),
        getUTXOs: vi.fn(async () => ({ utxos: outputs.map(({ vout }) => ({
            txid: seed?.wave?.fundingTxid, vout, confirmations: 1,
        })) })),
    };
    const sdk = {
        encoder,
        actions: { createAction: vi.fn(({ params }) => ({ actionString: JSON.stringify(params) })) },
        wallet: { decomposePsbt: vi.fn(() => ({ inputs: [{}], outputs })) },
        waitForAction: vi.fn(async () => ({
            actions: [{ action: 'FILE', action_index: actionIndex++ }],
        })),
        getAction: vi.fn(async () => ({ data: [{ multipart: { status: 'complete' } }] })),
    };
    const signer = { signPsbt: vi.fn(async ({ psbtHex }) => {
        signedNumber += 1;
        return { psbtHex, txid: txid(signedNumber), txHex: `${signedNumber}0aa` };
    }) };
    return { encoder, sdk, signer, vault: memoryVault(seed), sdkRegistry: { get: () => sdk } };
}

function options(h, overrides = {}) {
    return {
        vault: h.vault,
        walletId: 'wallet-1',
        chainId: 'bitcoin-regtest',
        from: SOURCE,
        bytes: BYTES,
        meta: { name: 'art.bin', type: 'application/octet-stream' },
        signer: h.signer,
        sdkRegistry: h.sdkRegistry,
        lane: 'envelope',
        buildMode: 'one_call',
        rate: 1,
        outputFloor: 100,
        sizes: { envelopePairVbytes: () => 8, standardPairBytes: () => 8 },
        planMultipartFile: vi.fn(async (_bytes, _meta, planOpts) => fakePlan(planOpts.gate)),
        manifestActionData: () => ({ action: 'FILE', params: { VERSION: '1' } }),
        sleep: vi.fn(async () => {}),
        ...overrides,
    };
}

function resumedRecord() {
    const gate = { ticker: 'XCP', minAmount: '5', key: KEY, iv: IV };
    const plan = fakePlan(gate);
    const record = createPendingFileUpload({
        walletId: 'wallet-1', chainId: 'bitcoin-regtest', sourceAddress: SOURCE.address,
        originalSha256: digest(BYTES), fileHash: plan.fileHash, meta: {},
        gate: recordGateOf(gate, plan), compression: '', totalParts: 2, totalBytes: 4,
        partDigests: DIGESTS, fundingOutputs: [0, 1, 2].map((vout) => ({
            txid: txid(90), vout, value: 400, scriptPubKey: `script-${vout}`,
        })),
        linkTarget: null,
    });
    record.wave.fundingTxid = txid(90);
    record.stage = 'sending';
    record.wave.pieces = [
        { index: -1, signedTxids: [txid(7), txid(8)], txid: txid(8), actionIndex: '30' },
        { index: 0, signedTxids: [txid(1), txid(2)], txid: txid(2), actionIndex: '31' },
        { index: 1, signedTxids: [], txid: null, actionIndex: null },
    ];
    return record;
}

describe('gated upload record metadata', () => {
    it('records exactly public gate fields from camel or wire spellings', () => {
        const fromCamel = recordGateOf(
            { ticker: 'XCP', minAmount: '5', key: KEY },
            { keyHash: digest(KEY).toUpperCase(), gateIv: IV.toUpperCase() },
        );
        const fromWire = recordGateOf(
            { GATE_TICKER: 'PEPE', GATE_MIN_AMOUNT: '7', key: KEY },
            { manifestParams: { keyHash: digest(KEY).toUpperCase() } },
        );
        expect(fromCamel).toEqual({
            ticker: 'XCP', minAmount: '5', keyHash: digest(KEY), iv: IV,
        });
        expect(fromWire).toEqual({
            ticker: 'PEPE', minAmount: '7', keyHash: digest(KEY), iv: null,
        });
        expect(Object.keys(fromCamel)).toEqual(['ticker', 'minAmount', 'keyHash', 'iv']);
    });

    it('returns null for no gate and does not reject incomplete planner data', () => {
        expect(recordGateOf(null, null)).toBeNull();
        expect(recordGateOf({}, {})).toEqual({
            ticker: '', minAmount: '', keyHash: '', iv: null,
        });
    });
});

describe('gated upload resume validation', () => {
    const saved = { ticker: 'XCP', minAmount: '5', keyHash: digest(KEY), iv: IV };

    it('restores the same key and IV for the planner', () => {
        expect(resumeGateOf(saved, KEY)).toEqual({
            ticker: 'XCP', minAmount: '5', key: KEY, iv: IV,
        });
    });

    it('refuses a different valid key', () => {
        expect(() => resumeGateOf(saved, OTHER_KEY)).toThrow(expect.objectContaining({
            code: 'GATED_RESUME_KEY_MISMATCH',
        }));
    });

    it.each([
        ['key', { ...saved }, new Uint8Array(31)],
        ['recordGate.keyHash', { ...saved, keyHash: saved.keyHash.toUpperCase() }, KEY],
        ['recordGate.keyHash', { ...saved, keyHash: 'aa' }, KEY],
        ['recordGate.keyHash', { ...saved, keyHash: Symbol('hash') }, KEY],
        ['recordGate.iv', { ...saved, iv: saved.iv.toUpperCase() }, KEY],
        ['recordGate.iv', { ...saved, iv: null }, KEY],
    ])('refuses invalid %s', (field, gate, key) => {
        expect(() => resumeGateOf(gate, key)).toThrow(expect.objectContaining({
            code: 'GATED_RECORD_GATE_INVALID', field,
        }));
    });
});

describe('gated upload record persistence', () => {
    it('saves only the four public gate fields and no key bytes', async () => {
        const h = harness();
        const result = await publishMultipartFile(options(h, {
            gate: { ticker: 'XCP', minAmount: '5', key: KEY },
        }));
        const serialized = JSON.stringify(result.record);
        expect(result.record.gate).toEqual({
            ticker: 'XCP', minAmount: '5', keyHash: digest(KEY), iv: IV,
        });
        expect(Object.keys(result.record.gate)).toEqual(['ticker', 'minAmount', 'keyHash', 'iv']);
        expect(serialized).not.toContain(Buffer.from(KEY).toString('hex'));
        expect(serialized).not.toContain(JSON.stringify(KEY));
    });

    it('continues to save a null gate for an ungated upload', async () => {
        const h = harness();
        const result = await publishMultipartFile(options(h));
        expect(result.record.gate).toBeNull();
    });
});

describe('gated upload resume integration', () => {
    it('reuses the saved IV, reads once, and sends only the missing piece', async () => {
        const record = resumedRecord();
        const h = harness(record);
        const opts = options(h, {
            resumeId: record.id,
            gate: { ticker: 'XCP', minAmount: '5', key: KEY },
        });
        const result = await publishMultipartFile(opts);
        const plannedGate = opts.planMultipartFile.mock.calls[0][2].gate;
        const pieceCalls = h.encoder.createTx.mock.calls.filter(([arg]) => !arg.customOutputs);
        expect(plannedGate).toEqual({ ticker: 'XCP', minAmount: '5', key: KEY, iv: IV });
        expect(result.record.fileHash).toBe(fakePlan(plannedGate).fileHash);
        expect(pieceCalls).toHaveLength(1);
        expect(h.vault.pendingFileUploads.get).toHaveBeenCalledTimes(1);
    });

    it('refuses another key before planning or creating a transaction', async () => {
        const record = resumedRecord();
        const h = harness(record);
        const opts = options(h, {
            resumeId: record.id,
            gate: { ticker: 'XCP', minAmount: '5', key: OTHER_KEY },
        });
        await expect(publishMultipartFile(opts)).rejects.toMatchObject({
            code: 'GATED_RESUME_KEY_MISMATCH',
        });
        expect(opts.planMultipartFile).not.toHaveBeenCalled();
        expect(h.encoder.createTx).not.toHaveBeenCalled();
        expect(h.vault.pendingFileUploads.get).toHaveBeenCalledTimes(1);
    });
});
