// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { publishMultipartFile } from '../../../packages/core/src/flows/publishMultipartFile.js';
import {
    createPendingFileUpload,
    validatePendingFileUpload,
} from '../../../packages/core/src/schemas/pendingFileUpload.js';

const SOURCE = {
    address: 'bcrt1qsource',
    publicKey: `02${'ab'.repeat(32)}`,
    derivationPath: "m/84'/1'/0'/0/0",
};
const BYTES = Uint8Array.of(7, 8, 9);
const FILE_HASH = 'cd'.repeat(32);
const DIGESTS = ['11'.repeat(32), '22'.repeat(32)];

function txid(number) {
    return number.toString(16).padStart(2, '0').repeat(32);
}

function originalDigest() {
    return createHash('sha256').update(BYTES).digest('hex');
}

function fakePlan(meta = {}) {
    const rawParts = [Uint8Array.of(1, 2), Uint8Array.of(3, 4)];
    return {
        parts: rawParts.map((rawData, partIndex) => ({
            partIndex, rawData, digest: DIGESTS[partIndex],
        })),
        fileHash: FILE_HASH,
        totalParts: 2,
        totalBytes: 4,
        compression: '',
        manifestParams: {
            fileHash: FILE_HASH, totalParts: 2, totalBytes: 4,
            name: meta.name || '', type: meta.type || '',
            title: meta.title || '', memo: meta.memo || '',
            gateTicker: '', encryptionMethod: '', keyHash: '',
            gateMinAmount: '', compression: '',
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

function harness(seed = null) {
    let signed = 0;
    let actionIndex = 40;
    const outputs = [0, 1, 2].map((vout) => ({
        vout, address: SOURCE.address, value: 400, scriptPubKey: `script-${vout}`,
    }));
    const encoder = {
        createTx: vi.fn(async (opts) => opts.customOutputs ? {
            psbt: 'funding',
            outputs: opts.customOutputs.map((output, vout) => ({
                vout, ...output, scriptPubKey: `script-${vout}`,
            })),
        } : { psbt: 'commit', revealPsbt: 'reveal' }),
        spendP2sh: vi.fn(async () => ({ psbt: 'standard-reveal' })),
        broadcastTx: vi.fn(async () => {}),
        getTxBlock: vi.fn(async () => ({ block_height: 12 })),
        getUTXOs: vi.fn(async () => ({ utxos: [] })),
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
        signed += 1;
        return { psbtHex, txid: txid(signed), txHex: `${String(signed).padStart(2, '0')}aa` };
    }) };
    return {
        encoder, sdk, signer, vault: memoryVault(seed),
        sdkRegistry: { get: vi.fn(() => sdk) },
    };
}

function options(h, overrides = {}) {
    return {
        vault: h.vault,
        walletId: 'wallet-1',
        chainId: 'bitcoin-regtest',
        from: SOURCE,
        bytes: BYTES,
        meta: { name: 'picked.bin', type: 'application/picked' },
        signer: h.signer,
        sdkRegistry: h.sdkRegistry,
        lane: 'envelope',
        buildMode: 'two_step',
        rate: 1,
        outputFloor: 100,
        sizes: { envelopePairVbytes: () => 8, standardPairBytes: () => 8 },
        planMultipartFile: vi.fn(async (_bytes, meta) => fakePlan(meta)),
        sleep: vi.fn(async () => {}),
        ...overrides,
    };
}

function savedStandardRecord() {
    const record = createPendingFileUpload({
        walletId: 'wallet-1', chainId: 'bitcoin-regtest', sourceAddress: SOURCE.address,
        originalSha256: originalDigest(), fileHash: FILE_HASH,
        meta: { name: 'saved.bin', type: 'application/saved', title: 'Saved', memo: 'Keep me' },
        lane: 'standard', buildMode: 'one_call', gate: null, compression: '',
        totalParts: 2, totalBytes: 4, partDigests: DIGESTS,
        fundingOutputs: [0, 1, 2].map((vout) => ({
            txid: txid(90), vout, value: 400, scriptPubKey: `script-${vout}`,
        })),
        linkTarget: null,
    });
    record.wave.fundingTxid = txid(90);
    record.stage = 'sending';
    record.wave.pieces[1] = {
        index: 0, signedTxids: [txid(11)], txid: txid(11), actionIndex: '31',
    };
    record.wave.pieces[2] = {
        index: 1, signedTxids: [txid(12)], txid: txid(12), actionIndex: '32',
    };
    return record;
}

describe('fresh multipart run lane persistence', () => {
    it.each([
        ['envelope', 'two_step'],
        ['standard', 'one_call'],
    ])('stores the %s lane and its %s build mode', async (lane, buildMode) => {
        const h = harness();
        const result = await publishMultipartFile(options(h, { lane, buildMode }));

        expect(result.record).toMatchObject({ lane, buildMode, stage: 'complete' });
        expect([...h.vault.rows.values()][0]).toMatchObject({ lane, buildMode });
    });
});

describe('saved multipart run configuration', () => {
    it('uses the saved Standard carrier, build mode, and manifest metadata', async () => {
        const record = savedStandardRecord();
        const h = harness(record);
        h.encoder.getUTXOs.mockResolvedValue({ utxos: [
            { txid: record.wave.fundingTxid, vout: 0, confirmations: 1 },
        ] });
        const planner = vi.fn(async (_bytes, meta) => fakePlan(meta));
        const envelopePairVbytes = vi.fn(() => 8);
        const standardPairBytes = vi.fn(() => 8);
        const result = await publishMultipartFile(options(h, {
            resumeId: record.id,
            lane: 'envelope',
            buildMode: 'two_step',
            meta: { name: 'picked.bin', title: '', memo: '' },
            planMultipartFile: planner,
            sizes: { envelopePairVbytes, standardPairBytes },
        }));

        expect(planner).toHaveBeenCalledWith(BYTES, record.meta, {
            carrier: 'standard', gate: null,
        });
        expect(standardPairBytes).toHaveBeenCalledTimes(3);
        expect(envelopePairVbytes).not.toHaveBeenCalled();
        expect(h.encoder.spendP2sh).toHaveBeenCalledTimes(1);
        // The wallet serializes the FILE version 1 manifest itself (multipartFileAction.js).
        const manifestData = h.encoder.createTx.mock.calls
            .map(([opts]) => opts.data)
            .find((data) => typeof data === 'string' && data.startsWith('FILE|1|'));
        expect(manifestData).toContain('|saved.bin|application/saved|Saved|Keep me');
        expect(result.record).toMatchObject({ stage: 'complete', lane: 'standard' });
    });
});

describe('pending upload lane and build mode validation', () => {
    it.each([null, 'envelope', 'standard'])('accepts lane %#', (lane) => {
        const record = savedStandardRecord();
        record.lane = lane;
        expect(validatePendingFileUpload(record).ok).toBe(true);
    });

    it.each([null, 'one_call', 'custom-mode'])('accepts buildMode %#', (buildMode) => {
        const record = savedStandardRecord();
        record.buildMode = buildMode;
        expect(validatePendingFileUpload(record).ok).toBe(true);
    });

    it.each([
        ['lane', 'p2sh'],
        ['lane', 1],
        ['buildMode', ''],
    ])('refuses %s %#', (field, value) => {
        const record = { ...savedStandardRecord(), [field]: value };
        const validation = validatePendingFileUpload(record);
        expect(validation.ok).toBe(false);
        expect(validation.errors).toContainEqual(expect.stringMatching(`^${field}:`));
    });
});
