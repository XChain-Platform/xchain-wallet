// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { publishMultipartFile } from '../../../packages/core/src/flows/publishMultipartFile.js';
import { createPendingFileUpload } from '../../../packages/core/src/schemas/pendingFileUpload.js';

const SOURCE = {
    address: 'bcrt1qsource',
    publicKey: `02${'ab'.repeat(32)}`,
    derivationPath: "m/84'/1'/0'/0/0",
};
const HASH = 'cd'.repeat(32);
const DIGESTS = ['11'.repeat(32), '22'.repeat(32)];
const BYTES = Uint8Array.of(7, 8, 9);

function fakePlan() {
    const parts = [Uint8Array.of(1, 2), Uint8Array.of(3, 4)];
    return {
        parts: parts.map((rawData, partIndex) => ({
            partIndex, rawData, digest: DIGESTS[partIndex],
        })),
        fileHash: HASH,
        totalParts: 2,
        totalBytes: 4,
        compression: '',
        manifestParams: {
            fileHash: HASH, totalParts: 2, totalBytes: 4,
            name: 'art.bin', type: 'application/octet-stream', title: '', memo: '',
            gateTicker: '', encryptionMethod: '', keyHash: '', gateMinAmount: '', compression: '',
        },
    };
}

function memoryVault(seed = null, events = []) {
    const rows = new Map(seed ? [[seed.id, seed]] : []);
    const history = [];
    return {
        rows, history,
        pendingFileUploads: {
            put: vi.fn(async (record) => {
                events.push(`put:${record.stage}:${record.wave?.fundingTxid ? 'funded' : 'empty'}`);
                history.push(structuredClone(record));
                rows.set(record.id, structuredClone(record));
            }),
            get: vi.fn(async (id) => rows.get(id) ? structuredClone(rows.get(id)) : null),
        },
    };
}

function txid(number) {
    return number.toString(16).padStart(2, '0').repeat(32);
}

function harness({
    lane = 'envelope', buildMode = 'one_call', multipart = 'complete', signedStart = 0,
} = {}) {
    const events = [];
    const broadcasts = [];
    let signedNumber = signedStart;
    let actionIndex = 40;
    const outputs = [0, 1, 2].map((vout) => ({
        vout, address: SOURCE.address, value: 400, scriptPubKey: `script-${vout}`,
    }));
    const encoder = {
        createTx: vi.fn(async (opts) => {
            events.push(opts.customOutputs ? 'create:funding' : 'create:piece');
            if (opts.customOutputs) return {
                psbt: 'funding-psbt',
                outputs: opts.customOutputs.map((output, vout) => ({
                    vout, ...output, scriptPubKey: `script-${vout}`,
                })),
            };
            if (opts.options?.envelopeCommitHex) return { psbt: 'two-step-reveal' };
            if (lane === 'standard') return { psbt: 'standard-commit', encoding: 'P2SH' };
            return { psbt: 'envelope-commit', revealPsbt: 'envelope-reveal', encoding: 'TAPROOT' };
        }),
        spendP2sh: vi.fn(async () => ({ psbt: 'standard-reveal' })),
        broadcastTx: vi.fn(async (hex) => { broadcasts.push(hex); events.push(`broadcast:${hex}`); }),
        getTxBlock: vi.fn(async () => ({ block_height: 12 })),
        getUTXOs: vi.fn(async () => ({ utxos: [] })),
    };
    const sdk = {
        encoder,
        actions: { createAction: vi.fn(({ params }) => ({ actionString: JSON.stringify(params) })) },
        wallet: { decomposePsbt: vi.fn(() => ({ inputs: [{}], outputs })) },
        waitForAction: vi.fn(async () => ({ actions: [{ action: 'FILE', action_index: actionIndex++ }] })),
        getAction: vi.fn(async () => ({ data: [{ multipart: {
            file_hash: HASH, total_parts: 2, parts_received: 2, total_bytes: 4, status: multipart,
        } }] })),
    };
    const signer = {
        signPsbt: vi.fn(async ({ psbtHex }) => {
            signedNumber += 1;
            return { psbtHex, txid: txid(signedNumber), txHex: `${signedNumber.toString(16).padStart(2, '0')}aa` };
        }),
    };
    const vault = memoryVault(null, events);
    const sdkRegistry = { get: vi.fn(() => sdk) };
    return { events, broadcasts, encoder, sdk, signer, vault, sdkRegistry, lane, buildMode };
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
        lane: h.lane,
        buildMode: h.buildMode,
        rate: 1,
        outputFloor: 100,
        sizes: { envelopePairVbytes: () => 8, standardPairBytes: () => 8 },
        planMultipartFile: vi.fn(async () => fakePlan()),
        sleep: vi.fn(async () => {}),
        ...overrides,
    };
}

function originalDigest() {
    return createHash('sha256').update(BYTES).digest('hex');
}

function resumedRecord() {
    const record = createPendingFileUpload({
        walletId: 'wallet-1', chainId: 'bitcoin-regtest', sourceAddress: SOURCE.address,
        originalSha256: originalDigest(), fileHash: HASH, meta: {}, gate: null,
        compression: '', totalParts: 2, totalBytes: 4, partDigests: DIGESTS,
        fundingOutputs: [0, 1, 2].map((vout) => ({
            txid: txid(90), vout, value: 400, scriptPubKey: `script-${vout}`,
        })),
        linkTarget: null,
    });
    record.wave.fundingTxid = txid(90);
    record.stage = 'sending';
    record.wave.pieces = [
        { index: -1, signedTxids: [txid(7), txid(8)], txid: txid(8), actionIndex: null },
        { index: 0, signedTxids: [txid(1), txid(2)], txid: txid(2), actionIndex: '31' },
        { index: 1, signedTxids: [txid(3), txid(4)], txid: txid(4), actionIndex: null },
    ];
    return record;
}

describe('multipart publish funding and envelope delivery', () => {
    it('checkpoints the record and signed recovery pairs before broadcast', async () => {
        const h = harness();
        const result = await publishMultipartFile(options(h));
        expect(result.record.stage).toBe('complete');
        expect(result.multipart.status).toBe('complete');
        expect(result.quote.outputs).toEqual([400, 400, 400]);
        expect(h.broadcasts).toHaveLength(7);
        expect(h.events.indexOf('put:funding:empty')).toBeLessThan(h.events.indexOf('create:funding'));
        const firstPieceBuild = h.events.indexOf('create:piece');
        const firstBroadcast = h.events.indexOf('broadcast:02aa');
        expect(h.events.slice(firstPieceBuild, firstBroadcast)
            .filter((event) => event === 'put:sending:funded'))
            .toHaveLength(2);
        const sent = h.vault.history.findLast((record) => record.wave?.pieces.every(
            (piece) => piece.actionIndex !== null,
        ));
        expect(sent.wave.pieces.every((piece) => piece.signedTxids.length === 2)).toBe(true);
    });
});

// The explorer can know a piece transaction before the indexer numbers its FILE
// action (the rail showed this at part 70 of 101): the piece is read again.
describe('multipart publish piece action indexes', () => {
    it('reads a piece again until the indexer gives its FILE action an index', async () => {
        const h = harness();
        const numbered = h.sdk.waitForAction.getMockImplementation();
        h.sdk.waitForAction.mockImplementationOnce(async () => ({ actions: [{ action: 'FILE', action_index: null }] }));
        h.sdk.waitForAction.mockImplementation(numbered);
        const result = await publishMultipartFile(options(h));
        expect(result.record.stage).toBe('complete');
        const sent = h.vault.history.findLast((record) => record.wave?.pieces.every(
            (piece) => piece.actionIndex !== null,
        ));
        expect(sent).toBeDefined();
    });
});

describe('multipart publish lane-specific builds', () => {
    it('uses two create calls for each non-segwit envelope piece', async () => {
        const h = harness({ buildMode: 'two_step' });
        await publishMultipartFile(options(h));
        const pieceCalls = h.encoder.createTx.mock.calls.map(([arg]) => arg)
            .filter((arg) => !arg.customOutputs);
        expect(pieceCalls.filter((arg) => arg.options.twoStepEnvelope)).toHaveLength(3);
        expect(pieceCalls.filter((arg) => arg.options.envelopeCommitHex)).toHaveLength(3);
        expect(h.encoder.spendP2sh).not.toHaveBeenCalled();
    });

    it('stores signed commit hex in each standard recovery record', async () => {
        const h = harness({ lane: 'standard' });
        const result = await publishMultipartFile(options(h));
        expect(h.encoder.spendP2sh).toHaveBeenCalledTimes(3);
        const sent = h.vault.history.findLast((record) => record.wave?.pieces.every(
            (piece) => piece.actionIndex !== null,
        ));
        expect(sent.wave.pieces.every((piece) => piece.signedTxids.length === 3)).toBe(true);
        expect(sent.wave.pieces.every((piece) => piece.signedTxids[0].endsWith('aa'))).toBe(true);
    });
});

describe('multipart publish activation and terminal mismatch', () => {
    it('fails closed before writing or signing on an unarmed network', async () => {
        const h = harness();
        await expect(publishMultipartFile(options(h, {
            chainId: 'bitcoin-mainnet',
            activationTimes: { mainnet: 'UNARMED', testnet: 0, regtest: 0 },
        }))).rejects.toMatchObject({ code: 'MULTIPART_NOT_ACTIVE' });
        expect(h.vault.pendingFileUploads.put).not.toHaveBeenCalled();
        expect(h.signer.signPsbt).not.toHaveBeenCalled();
    });

    it('persists mismatch as a terminal stage', async () => {
        const h = harness({ multipart: 'mismatch' });
        await expect(publishMultipartFile(options(h))).rejects.toMatchObject({
            code: 'FILE_MULTIPART_MISMATCH',
        });
        expect([...h.vault.rows.values()][0].stage).toBe('mismatch');
    });
});

describe('multipart publish resume safety', () => {
    it('waits on mined and mempool pieces and re-sends only a missing funded piece', async () => {
        const record = resumedRecord();
        const h = harness({ signedStart: 100 });
        h.vault = memoryVault(record, h.events);
        h.encoder.getTxBlock.mockImplementation(async (id) => (
            [record.wave.fundingTxid, txid(2), txid(8)].includes(id)
                ? { block_height: 12 } : null
        ));
        h.encoder.getUTXOs.mockResolvedValue({ utxos: [
            { txid: record.wave.fundingTxid, vout: 0, confirmations: 1 },
            { txid: record.wave.fundingTxid, vout: 2, confirmations: 1 },
        ] });
        const result = await publishMultipartFile(options(h, { resumeId: record.id }));
        expect(result.record.stage).toBe('complete');
        expect(h.signer.signPsbt).toHaveBeenCalledTimes(2);
        expect(h.broadcasts).toHaveLength(2);
        expect(h.sdk.waitForAction).toHaveBeenCalledTimes(2);
        const sent = h.vault.history.findLast((saved) => saved.wave?.pieces.every(
            (piece) => piece.actionIndex !== null,
        ));
        expect(sent.wave.pieces.find((piece) => piece.index === 0).txid).toBe(txid(2));
        expect(sent.wave.pieces.find((piece) => piece.index === 1).txid).toBe(txid(102));
    });

    it('refuses a re-picked file before any chain or signing effect', async () => {
        const record = resumedRecord();
        record.originalSha256 = 'ff'.repeat(32);
        const h = harness();
        h.vault = memoryVault(record, h.events);
        await expect(publishMultipartFile(options(h, { resumeId: record.id })))
            .rejects.toMatchObject({ code: 'RESUME_ORIGINAL_MISMATCH' });
        expect(h.signer.signPsbt).not.toHaveBeenCalled();
        expect(h.encoder.getTxBlock).not.toHaveBeenCalled();
    });

    it.each([
        ['RESUME_PLAN_MISMATCH', {
            planMultipartFile: vi.fn(async () => ({ ...fakePlan(), fileHash: 'ee'.repeat(32) })),
        }],
        ['RESUME_SOURCE_MISMATCH', {
            from: { ...SOURCE, address: 'bcrt1qother' },
        }],
    ])('refuses %s before reading the saved transactions', async (code, overrides) => {
        const record = resumedRecord();
        const h = harness();
        h.vault = memoryVault(record, h.events);
        await expect(publishMultipartFile(options(h, { resumeId: record.id, ...overrides })))
            .rejects.toMatchObject({ code });
        expect(h.signer.signPsbt).not.toHaveBeenCalled();
        expect(h.encoder.getTxBlock).not.toHaveBeenCalled();
    });
});

// The tracker sees a just-broadcast funding transaction seconds later, and the
// explorer's mempool rows never list a plain funding transaction, so the first
// readings after the broadcast find it nowhere.
function fundingSeenOnThirdReading(h) {
    let readings = 0;
    h.encoder.getTxBlock.mockImplementation(async () => {
        readings += 1;
        return readings > 2 ? { block_height: 12 } : null;
    });
    h.sdk.getUnconfirmed = vi.fn(async () => []);
}

describe('multipart publish funding wait after the broadcast', () => {
    it('keeps waiting while a fresh funding transaction is not yet visible', async () => {
        const h = harness();
        fundingSeenOnThirdReading(h);
        const result = await publishMultipartFile(options(h));
        expect(result.record.stage).toBe('complete');
        expect(h.encoder.getTxBlock.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it('still ends on two dropped readings once the grace has passed', async () => {
        const h = harness();
        fundingSeenOnThirdReading(h);
        await expect(publishMultipartFile(options(h, { fundingDropGraceMs: 0 })))
            .rejects.toMatchObject({ code: 'FILE_FUNDING_NOT_CONFIRMED', chainState: 'dropped' });
        expect(h.encoder.createTx.mock.calls.filter(([opts]) => !opts.customOutputs)).toHaveLength(0);
    });
});
