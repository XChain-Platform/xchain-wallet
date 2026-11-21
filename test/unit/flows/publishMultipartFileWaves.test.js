// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { publishMultipartFile } from '../../../packages/core/src/flows/publishMultipartFile.js';
import { createFakeMultipartChain } from '../../helpers/multipartFakeChain.js';
import { recordingPartSource } from '../../helpers/recordingPartSource.js';

const SOURCE = {
    address: 'bcrt1qsource',
    publicKey: `02${'ab'.repeat(32)}`,
    derivationPath: "m/84'/1'/0'/0/0",
};
const PARTS = 250;
const PART_BYTES = 10;
const PART_DIGEST = createHash('sha256').update(new Uint8Array(PART_BYTES)).digest();
const FILE_HASH = createHash('sha256')
    .update(Buffer.concat(Array.from({ length: PARTS }, () => PART_DIGEST)))
    .digest('hex');

function txid(number) {
    return number.toString(16).padStart(8, '0').repeat(8);
}

async function planSource(source) {
    const parts = [];
    const original = createHash('sha256');
    for (let index = 0; index < PARTS; index += 1) {
        const bytes = await source.readSlice(index * PART_BYTES, (index + 1) * PART_BYTES);
        original.update(bytes);
        parts.push({
            partIndex: index,
            digest: createHash('sha256').update(bytes).digest('hex'),
            byteLength: bytes.length,
        });
    }
    return {
        parts,
        partCapacity: PART_BYTES,
        originalBytes: source.size,
        originalSha256: original.digest('hex'),
        fileHash: FILE_HASH,
        totalParts: PARTS,
        totalBytes: source.size,
        compression: '',
        manifestParams: {
            fileHash: FILE_HASH,
            totalParts: PARTS,
            totalBytes: source.size,
            name: source.name,
            type: source.type,
            title: '',
            memo: '',
            gateTicker: '',
            encryptionMethod: '',
            keyHash: '',
            gateMinAmount: '',
            compression: '',
        },
    };
}

function memoryVault() {
    const rows = new Map();
    return {
        rows,
        pendingFileUploads: {
            put: vi.fn(async (record) => rows.set(record.id, structuredClone(record))),
            get: vi.fn(async (id) => rows.get(id) ? structuredClone(rows.get(id)) : null),
        },
    };
}

function harness({
    stopBeforeFunding = null,
    vault = memoryVault(),
    chain = createFakeMultipartChain(),
    signedStart = 0,
} = {}) {
    const funding = [];
    const builtPieces = [];
    const revealPieces = new Map();
    let signed = signedStart;
    let pieceBuild = 0;
    const encoder = {
        createTx: vi.fn(async (request) => {
            if (request.customOutputs) {
                const number = funding.length + 1;
                if (number === stopBeforeFunding) throw new Error(`stop before funding ${number}`);
                if (funding.length > 0) {
                    expect(chain.piecesFor(SOURCE.address).every(
                        (piece) => piece.state === 'confirmed',
                    )).toBe(true);
                }
                funding.push(request);
                return {
                    psbt: `funding-${number}`,
                    outputs: request.customOutputs.map((output, vout) => ({
                        ...output,
                        vout,
                        scriptPubKey: `funding-script-${number}-${vout}`,
                    })),
                };
            }
            pieceBuild += 1;
            const fields = String(request.data).split('|');
            const manifest = fields[1] === '1';
            const partIndex = manifest ? null : Number(fields[3]);
            builtPieces.push(manifest ? -1 : partIndex);
            const revealPsbt = `reveal-${pieceBuild}`;
            revealPieces.set(revealPsbt, {
                kind: manifest ? 'manifest' : 'part',
                source: SOURCE.address,
                fileHash: FILE_HASH,
                totalParts: PARTS,
                totalBytes: PARTS * PART_BYTES,
                partIndex,
                rawData: manifest ? undefined : Uint8Array.from(request.rawData, (char) => char.charCodeAt(0)),
            });
            return { psbt: `commit-${pieceBuild}`, revealPsbt };
        }),
        broadcastTx: vi.fn(async () => {}),
        getTxBlock: vi.fn(async () => ({ block_height: 12 })),
        getUTXOs: vi.fn(async () => ({ utxos: [] })),
    };
    const sdk = {
        encoder,
        actions: { createAction: ({ params }) => ({ actionString: JSON.stringify(params) }) },
        wallet: { decomposePsbt: () => ({ inputs: [{}], outputs: [] }) },
        waitForAction: vi.fn(async (id) => {
            chain.mine();
            return { actions: [{ action: 'FILE', action_index: chain.actionIndexOf(id) }] };
        }),
        getAction: (index) => chain.sdk().getAction(Number(index)),
    };
    const signer = {
        kind: 'software',
        signPsbt: vi.fn(async ({ psbtHex }) => {
            signed += 1;
            const id = txid(signed);
            const piece = revealPieces.get(psbtHex);
            if (piece) chain.addPiece({ ...piece, txid: id, state: 'mempool' });
            return { txid: id, txHex: `${signed.toString(16).padStart(2, '0')}aa` };
        }),
    };
    return { builtPieces, chain, encoder, funding, sdk, signer, vault };
}

function options(run, partSource, overrides = {}) {
    return {
        vault: run.vault,
        walletId: 'wallet-1',
        chainId: 'bitcoin-regtest',
        from: SOURCE,
        partSource,
        meta: { name: 'large.bin', type: 'application/octet-stream' },
        signer: run.signer,
        sdkRegistry: { get: () => run.sdk },
        lane: 'envelope',
        buildMode: 'one_call',
        rate: 2,
        outputFloor: 100,
        sizes: { envelopePairVbytes: () => 8, standardPairBytes: () => 8 },
        planMultipartStream: planSource,
        waitForFunding: vi.fn(async () => ({ block_height: 12 })),
        sleep: vi.fn(async () => {}),
        ...overrides,
    };
}

describe('multipart publish waves', () => {
    it('sends 250 parts in three bounded confirmed waves after one quote', async () => {
        const source = recordingPartSource(new Uint8Array(PARTS * PART_BYTES), {
            name: 'large.bin', type: 'application/octet-stream',
        });
        const run = harness();
        const result = await publishMultipartFile(options(run, source));

        expect(run.funding.map((request) => request.customOutputs.length)).toEqual([100, 100, 51]);
        expect(run.funding.every((request) => request.feePerKb === 2000)).toBe(true);
        expect(run.builtPieces).toEqual([
            ...Array.from({ length: PARTS }, (_unused, index) => index),
            -1,
        ]);
        expect(run.chain.mempoolHighWater()).toBeLessThanOrEqual(100);
        expect(result.quote.transactions).toBe(505);
        expect(result.quote.fundingFees).toHaveLength(3);
        expect(result.quote.fundingFees.every((fee) => fee > 0)).toBe(true);
        expect(result.record).toMatchObject({
            approvedRate: 2, stage: 'complete', wavesDone: 3, wave: null,
        });
        expect(source.readWhole()).toBe(false);
        expect(source.largestRead()).toBe(PART_BYTES);
    });

    it('resumes at wave two after reading one planner pass and only unsent parts', async () => {
        const source = recordingPartSource(new Uint8Array(PARTS * PART_BYTES));
        const first = harness({ stopBeforeFunding: 2 });
        await expect(publishMultipartFile(options(first, source))).rejects.toThrow('stop before funding 2');
        const record = [...first.vault.rows.values()][0];
        expect(record).toMatchObject({ wavesDone: 1, wave: { index: 1, fundingTxid: null } });

        source.resetReads();
        const resumed = harness({ vault: first.vault, chain: first.chain, signedStart: 10_000 });
        const result = await publishMultipartFile(options(resumed, source, {
            resumeId: record.id,
            rate: 99,
        }));

        expect(resumed.funding.map((request) => request.customOutputs.length)).toEqual([100, 51]);
        expect(resumed.funding.every((request) => request.feePerKb === 2000)).toBe(true);
        expect(resumed.builtPieces).toEqual([
            ...Array.from({ length: 150 }, (_unused, index) => index + 100),
            -1,
        ]);
        expect(source.reads()).toHaveLength(PARTS + 150);
        expect(source.bytesRead()).toBe((PARTS + 150) * PART_BYTES);
        expect(source.readWhole()).toBe(false);
        expect(result.record).toMatchObject({ stage: 'complete', wavesDone: 3, wave: null });
    });
});
