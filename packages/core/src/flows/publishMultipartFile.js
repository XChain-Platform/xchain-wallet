// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { chainTipBlockTime } from './balances.js';
import { legChainStatus } from './deployLegWait.js';
import { assertMultipartActive } from './multipartActivationGate.js';
import {
    FILE_MULTIPART_ACTIVATION_TIME,
} from './fileSizeLimits.js';
import { binaryStringOf, filePieceEncoderOpts } from './filePieceEncoderOpts.js';
import {
    recordPieceBeforeBroadcast,
    recoveryRecordFor,
} from './filePieceRecovery.js';
import { planResend } from './filePieceSequencer.js';
import {
    filePieceMayBeOnChain,
    waitForFilePieceIndexed,
    waitForMultipartComplete,
} from './filePieceWait.js';
import { matchFundingOutputs } from './multipartFundingMatch.js';
import { multipartFundingEncoderOpts } from './multipartFundingOpts.js';
import { waitForFundingConfirmed } from './multipartFundingWait.js';
import { planMultipartFile, quoteMultipartFile } from './multipartFilePlan.js';
import { planMultipartStream, readPlannedParts } from './multipartStreamPlan.js';
import { bytesPartSource } from './filePartSource.js';
import { multipartQuoteLanes } from './multipartQuoteLanes.js';
import { multipartWaveCount, multipartWaveRanges } from './multipartWaves.js';
import { multipartFileActionString } from './multipartFileAction.js';
import { confirmResumePick } from './multipartResumeMatch.js';
import { advanceUploadStage, withFunding } from './multipartUploadRecord.js';
import { createPendingFileUpload } from '../schemas/pendingFileUpload.js';
import { normalizeSource } from './sendToken.js';
import { utxoListOf } from './txInclusionProbe.js';
import { isAlreadyOnNetworkRejection } from './broadcastPermanence.js';
import { gatedManifestActionData } from './gatedMultipartManifest.js';
import { recordGateOf, resumeGateOf } from './gatedUploadGate.js';

const TXID = /^[0-9a-f]{64}$/i;
const PROTOCOL_COIN_TICKER = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };
const defaultSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
// A just-broadcast funding transaction reaches the tracker's UTXO view seconds
// later, and a plain funding transaction never shows in the explorer's mempool
// rows, so a reading in this window that finds it nowhere is not yet evidence
// that the network dropped it.
const FUNDING_DROP_GRACE_MS = 60_000;

function progress(opts, phase, data = {}) {
    if (typeof opts.onProgress === 'function') opts.onProgress(phase, data);
}

function sourcePath(source) {
    return source.derivationPath
        ? { inputIndex: 0, path: source.derivationPath }
        : { inputIndex: 0, addressId: source.addressId };
}

function signingPaths(sdk, psbtHex, source) {
    const base = sourcePath(source);
    try {
        const count = sdk.wallet.decomposePsbt(psbtHex).inputs.length;
        return Array.from({ length: Math.max(1, count) }, (_unused, inputIndex) => ({
            ...base, inputIndex,
        }));
    } catch {
        return [base];
    }
}

async function signPsbt({ sdk, signer, chainId, source, psbt, reveal = false }) {
    return signer.signPsbt({
        psbtHex: psbt,
        chainId,
        signingPaths: signingPaths(sdk, psbt, source),
        ...(reveal ? { reveal: true } : {}),
    });
}

async function broadcast(encoder, signed) {
    try {
        await encoder.broadcastTx(signed.txHex);
    } catch (error) {
        if (!isAlreadyOnNetworkRejection(error)) throw error;
    }
}

function manifestParams(plan) {
    const value = plan.manifestParams;
    return {
        VERSION: '1',
        FILE_HASH: value.fileHash,
        TOTAL_PARTS: String(value.totalParts),
        TOTAL_BYTES: String(value.totalBytes),
        NAME: value.name,
        TYPE: value.type,
        TITLE: value.title,
        MEMO: value.memo,
        GATE_TICKER: value.gateTicker,
        ENCRYPTION_METHOD: String(value.encryptionMethod || ''),
        KEY_HASH: value.keyHash,
        GATE_MIN_AMOUNT: String(value.gateMinAmount || ''),
        COMPRESSION: String(value.compression || ''),
    };
}

function pieceAction(plan, index, opts) {
    if (index === -1 && typeof opts.manifestActionData === 'function') {
        return opts.manifestActionData(plan.manifestParams);
    }
    const params = index === -1 ? manifestParams(plan) : {
        VERSION: '2', FILE_HASH: plan.fileHash, PART_INDEX: String(index),
    };
    return { action: 'FILE', params };
}

function pieceInput(plan, index, ctx) {
    const actionData = pieceAction(plan, index, ctx.opts);
    const data = multipartFileActionString(actionData)
        ?? ctx.sdk.actions.createAction(actionData).actionString;
    return {
        kind: index === -1 ? 'manifest' : 'part',
        data,
        rawData: index === -1 ? undefined : ctx.part?.rawData,
    };
}

function pieceEncoderArgs(ctx, input, phase, signedCommitHex) {
    return {
        pieceKind: input.kind,
        lane: ctx.lane,
        buildMode: ctx.buildMode,
        phase,
        source: ctx.source,
        fundingOutput: ctx.fundingOutput,
        rate: ctx.rate,
        data: input.data,
        rawData: input.rawData,
        signedCommitHex,
    };
}

async function envelopeSignedPair(ctx, input) {
    const commitOpts = filePieceEncoderOpts(pieceEncoderArgs(ctx, input, 'commit'));
    const encoded = await ctx.sdk.encoder.createTx(commitOpts);
    const commit = await signPsbt({ ...ctx, psbt: encoded.psbt });
    let revealPsbt = encoded.revealPsbt;
    if (ctx.buildMode === 'two_step') {
        const revealOpts = filePieceEncoderOpts(
            pieceEncoderArgs(ctx, input, 'reveal', commit.txHex),
        );
        revealPsbt = (await ctx.sdk.encoder.createTx(revealOpts)).psbt;
    }
    const reveal = await ctx.signer.signPsbt({
        psbtHex: revealPsbt,
        chainId: ctx.chainId,
        signingPaths: signingPaths(ctx.sdk, revealPsbt, ctx.source),
        envelopeReveal: true,
    });
    return { commit, reveal };
}

async function standardSignedPair(ctx, input) {
    const commitOpts = filePieceEncoderOpts(pieceEncoderArgs(ctx, input, 'commit'));
    const encoded = await ctx.sdk.encoder.createTx(commitOpts);
    const commit = await signPsbt({ ...ctx, psbt: encoded.psbt });
    const revealBuilt = await ctx.sdk.encoder.spendP2sh({
        pubkey: ctx.source.address,
        p2shHash: commit.txid,
        p2shHex: commit.txHex,
        data: input.data,
        encoding: 'P2SH',
        ...(input.rawData === undefined ? {} : { rawData: binaryStringOf(input.rawData) }),
        change: ctx.source.address,
        feePerKb: ctx.rate * 1000,
    });
    const reveal = await signPsbt({ ...ctx, psbt: revealBuilt.psbt, reveal: true });
    return { commit, reveal };
}

function replacePiece(record, index, fields) {
    const wave = record.wave;
    if (wave) {
        return {
            ...record,
            wave: {
                ...wave,
                pieces: wave.pieces.map((piece) => (
                    piece.index === index ? { ...piece, ...fields } : piece
                )),
            },
        };
    }
    return {
        ...record,
        pieces: record.pieces.map((piece) => (
            piece.index === index ? { ...piece, ...fields } : piece
        )),
    };
}

async function signAndBroadcastPiece(ctx, index) {
    const input = pieceInput(ctx.plan, index, ctx);
    const pair = ctx.lane === 'envelope'
        ? await envelopeSignedPair(ctx, input)
        : await standardSignedPair(ctx, input);
    const signedTxids = recoveryRecordFor({
        lane: ctx.lane,
        signedCommitHex: pair.commit.txHex,
        commitTxid: pair.commit.txid,
        revealPlan: pair.reveal,
    });
    const cleared = replacePiece(ctx.record, index, { signedTxids: [] });
    ctx.record = await recordPieceBeforeBroadcast({
        record: cleared, index, lane: ctx.lane, signedTxids, save: ctx.save,
    });
    ctx.record = replacePiece(ctx.record, index, { txid: pair.reveal.txid });
    await ctx.save(ctx.record);
    await broadcast(ctx.sdk.encoder, pair.commit);
    await broadcast(ctx.sdk.encoder, pair.reveal);
    progress(ctx.opts, 'piece-broadcast', { index, txid: pair.reveal.txid });
}

function indexedActionIndex(indexed) {
    const value = indexed?.indexed ?? indexed;
    const direct = value?.action_index ?? value?.actionIndex;
    if (direct !== undefined && direct !== null) return String(direct);
    const actions = Array.isArray(value?.actions) ? value.actions : [];
    const file = actions.find((item) => String(item?.action).toUpperCase() === 'FILE')
        || (actions.length === 1 ? actions[0] : null);
    const result = file?.action_index ?? file?.actionIndex;
    return result === undefined || result === null ? null : String(result);
}

async function waitForPiece(ctx, index) {
    const pieces = ctx.record.wave?.pieces ?? ctx.record.pieces;
    const piece = pieces.find((item) => item.index === index);
    const indexed = await waitForFilePieceIndexed({
        waitForTxid: ctx.waitForTxid,
        sdk: ctx.sdk,
        txid: piece.txid,
        address: ctx.source.address,
        pieceLabel: index === -1 ? 'File manifest' : `File part ${index + 1} of ${ctx.plan.totalParts}`,
        patienceMs: ctx.opts.indexPatienceMs,
        onChainWait: (state) => progress(ctx.opts, 'piece-wait', { index, ...state }),
    });
    const actionIndex = indexedActionIndex(indexed);
    if (!actionIndex) throw new Error(`File piece ${index} indexed without an action index`);
    return { index, actionIndex };
}

function normalizeOutput(output, index) {
    return {
        vout: Number(output.vout ?? output.index ?? output.n ?? index),
        address: output.address ?? output.scriptPubKey?.address,
        value: Number(output.value),
        scriptPubKey: typeof output.scriptPubKey === 'string'
            ? output.scriptPubKey
            : (output.scriptPubKey?.hex ?? output.scriptPubKeyHex ?? output.script),
    };
}

function fundingOutputs(sdk, encoded, signed) {
    const direct = signed.outputs ?? encoded.outputs;
    if (Array.isArray(direct)) return direct.map(normalizeOutput);
    const decomposed = sdk.wallet.decomposePsbt(encoded.psbt);
    return (decomposed.outputs || []).map(normalizeOutput);
}

async function feeRate(opts, sdk) {
    if (Number.isFinite(opts.rate) && opts.rate > 0) return Number(opts.rate);
    const estimate = sdk.encoder.estimateFee ?? sdk.encoder.estimate_fee;
    if (typeof estimate !== 'function') throw new Error('publishMultipartFile: fee rate is required');
    const result = await estimate.call(sdk.encoder);
    const high = result?.high?.rate ?? result?.high;
    if (!Number.isFinite(high) || high <= 0) throw new Error('publishMultipartFile: invalid high fee rate');
    return Number(high);
}

function quoteFor(opts, plan, rate, lane) {
    const descriptor = opts.chainRegistry?.get?.(opts.chainId);
    const lanes = multipartQuoteLanes({ descriptor, outputFloor: opts.outputFloor });
    return quoteMultipartFile(plan, rate, lanes[lane], opts.sizes || {});
}

async function waitForFunding(ctx, txid) {
    if (typeof ctx.opts.waitForFunding === 'function') {
        return ctx.opts.waitForFunding({ sdk: ctx.sdk, txid, address: ctx.source.address });
    }
    const sleep = ctx.opts.sleep ?? defaultSleep;
    const pollMs = Number(ctx.opts.fundingPollMs) > 0 ? Number(ctx.opts.fundingPollMs) : 2000;
    const timeout = Number(ctx.opts.fundingTimeoutMs) > 0 ? Number(ctx.opts.fundingTimeoutMs) : 900000;
    const grace = Number(ctx.opts.fundingDropGraceMs) >= 0
        ? Number(ctx.opts.fundingDropGraceMs) : FUNDING_DROP_GRACE_MS;
    return waitForFundingConfirmed({
        sdk: ctx.sdk,
        txid,
        address: ctx.source.address,
        timeoutMs: timeout,
        pollMs,
        sleep,
        now: Date.now,
        dropGraceMs: grace,
    });
}

async function fundUpload(ctx, pieceValues) {
    const opts = multipartFundingEncoderOpts({
        source: ctx.source, pieceValues, rate: ctx.rate,
    });
    const encoded = await ctx.sdk.encoder.createTx(opts);
    const signed = await signPsbt({ ...ctx, psbt: encoded.psbt });
    const expected = opts.customOutputs;
    const outputs = matchFundingOutputs(expected, fundingOutputs(ctx.sdk, encoded, signed), signed.txid);
    ctx.record = withFunding(ctx.record, { fundingTxid: signed.txid, fundingOutputs: outputs });
    await ctx.save(ctx.record);
    await broadcast(ctx.sdk.encoder, signed);
    progress(ctx.opts, 'funding-broadcast', {
        wave: ctx.record.wave?.index ?? 0, txid: signed.txid,
    });
    await waitForFunding(ctx, signed.txid);
    if (ctx.record.stage === 'funding') {
        ctx.record = advanceUploadStage(ctx.record, 'sending');
        await ctx.save(ctx.record);
    }
}

async function chainStatesFor(ctx) {
    let utxos = null;
    try { utxos = utxoListOf(await ctx.sdk.encoder.getUTXOs(ctx.source.address)); } catch {}
    const live = new Set((utxos || []).map((item) => `${String(item.txid).toLowerCase()}:${item.vout}`));
    const wave = ctx.record.wave ?? ctx.record;
    const fundingOutputs = wave.fundingOutputs.map((output) => ({
            ...output,
            unspent: live.has(`${String(output.txid).toLowerCase()}:${output.vout}`),
        }));
    ctx.record = ctx.record.wave
        ? { ...ctx.record, wave: { ...ctx.record.wave, fundingOutputs } }
        : { ...ctx.record, fundingOutputs };
    const txids = new Set([
        wave.fundingTxid,
        ...wave.pieces.flatMap((piece) => [...piece.signedTxids, piece.txid]),
    ]);
    const entries = await Promise.all([...txids].filter(Boolean).map(async (txid) => {
        if (!TXID.test(txid)) return [txid, 'dropped'];
        return [txid, await legChainStatus({ sdk: ctx.sdk, txid, address: ctx.source.address })];
    }));
    return Object.fromEntries(entries);
}

async function resumePlan(ctx) {
    const chainStates = await chainStatesFor(ctx);
    const resend = planResend({ record: ctx.record, chainStates });
    if (resend.funding !== 'done') {
        await waitForFunding(ctx, ctx.record.wave?.fundingTxid ?? ctx.record.fundingTxid);
    }
    if (resend.blocked) {
        const error = new Error('A missing file piece no longer has an unspent funding output.');
        error.code = resend.blocked;
        throw error;
    }
    const wait = new Set(resend.wait);
    for (const index of resend.skip) {
        const pieces = ctx.record.wave?.pieces ?? ctx.record.pieces;
        const piece = pieces.find((item) => item.index === index);
        if (!piece?.actionIndex) wait.add(index);
    }
    return { send: resend.send, wait: [...wait] };
}

function outputFor(record, index) {
    const wave = record.wave ?? record;
    const position = wave.pieces.findIndex((piece) => piece.index === index);
    return wave.fundingOutputs[position];
}

async function streamingParts(ctx, indexes) {
    if (!ctx.partSource || indexes.length === 0) return null;
    const wanted = [...indexes].filter((index) => index >= 0).sort((a, b) => a - b);
    if (wanted.length === 0) return null;
    if (ctx.streamingPartReader) return ctx.streamingPartReader;
    const reader = ctx.opts.readPlannedParts || readPlannedParts;
    let readPlan = ctx.plan;
    let readSource = ctx.partSource;
    let fromPart = wanted[0];
    if (reader === readPlannedParts && !ctx.plan.compressed && fromPart > 0) {
        const start = ctx.plan.parts.slice(0, fromPart)
            .reduce((total, part) => total + part.byteLength, 0);
        const source = ctx.partSource;
        readSource = {
            size: source.size - start,
            name: source.name,
            type: source.type,
            readSlice: (from, to) => source.readSlice(start + from, start + to),
        };
        readPlan = {
            ...ctx.plan,
            parts: ctx.plan.parts.slice(fromPart),
            originalBytes: readSource.size,
        };
        fromPart = 0;
    }
    const iterable = await reader(readPlan, readSource, fromPart);
    const iterator = iterable[Symbol.asyncIterator]();
    ctx.streamingPartReader = {
        async get(index) {
            for (;;) {
                const next = await iterator.next();
                if (next.done) throw new Error(`Planned part ${index} was not regenerated`);
                if (next.value.partIndex === index) return next.value;
                if (next.value.partIndex > index) {
                    throw new Error(`Planned part ${index} was skipped while regenerating`);
                }
            }
        },
    };
    return ctx.streamingPartReader;
}

async function sendAndIndex(ctx, plan) {
    const partReader = await streamingParts(ctx, plan.send);
    for (const index of plan.send) {
        ctx.part = index === -1
            ? null
            : (partReader ? await partReader.get(index) : ctx.plan.parts[index]);
        ctx.fundingOutput = outputFor(ctx.record, index);
        await signAndBroadcastPiece(ctx, index);
    }
    const indexes = [...new Set([...plan.wait, ...plan.send])];
    const results = await Promise.all(indexes.map((index) => waitForPiece(ctx, index)));
    for (const result of results) {
        ctx.record = replacePiece(ctx.record, result.index, { actionIndex: result.actionIndex });
        if (result.index === -1) {
            const manifest = ctx.record.wave.pieces.find((piece) => piece.index === -1);
            ctx.record = {
                ...ctx.record,
                manifestActionIndex: result.actionIndex,
                manifestTxid: manifest.txid,
            };
        }
    }
    await ctx.save(ctx.record);
}

function multipartFrom(detail) {
    let value = detail?.data ?? detail;
    if (Array.isArray(value)) value = value[0];
    if (value?.action && typeof value.action === 'object') value = value.action;
    return value?.multipart ?? null;
}

async function finishAssembly(ctx) {
    if (ctx.record.stage === 'sending') {
        ctx.record = advanceUploadStage(ctx.record, 'assembling');
        await ctx.save(ctx.record);
    }
    const manifest = {
        actionIndex: ctx.record.manifestActionIndex,
        txid: ctx.record.manifestTxid,
    };
    if (!manifest.actionIndex) {
        throw new Error('Multipart manifest action index is unavailable');
    }
    try {
        const multipart = await waitForMultipartComplete({
            sdk: ctx.sdk,
            fileId: manifest.actionIndex,
            readMultipart: async (fileId) => multipartFrom(await ctx.sdk.getAction(fileId)),
            pollMs: ctx.opts.multipartPollMs,
            timeoutMs: ctx.opts.multipartTimeoutMs,
            sleep: ctx.opts.sleep,
        });
        ctx.record = advanceUploadStage(ctx.record, 'complete');
        await ctx.save(ctx.record);
        return { multipart, manifest };
    } catch (error) {
        if (error?.code === 'FILE_MULTIPART_MISMATCH') {
            ctx.record = advanceUploadStage(ctx.record, 'mismatch');
            await ctx.save(ctx.record);
        }
        throw error;
    }
}

function laneConfig(opts) {
    const support = opts.support || {};
    const lane = opts.lane || support.lane;
    if (!['envelope', 'standard'].includes(lane)) {
        throw new Error('publishMultipartFile: lane must be envelope or standard');
    }
    const addressType = opts.addressType || opts.from?.type || opts.source?.type;
    const legacyEnvelope = lane === 'envelope'
        && ['p2pkh', 'p2sh-p2wpkh'].includes(String(addressType).toLowerCase());
    const buildMode = opts.buildMode || support.buildMode
        || (legacyEnvelope ? 'two_step' : 'one_call');
    return { lane, buildMode };
}

async function initialRecord(opts, source, plan, quote, rate, originalSha256, config) {
    const record = createPendingFileUpload({
        walletId: opts.walletId,
        chainId: opts.chainId,
        sourceAddress: source.address,
        originalSha256,
        fileHash: plan.fileHash,
        meta: opts.meta || {},
        lane: config.lane,
        buildMode: config.buildMode,
        gate: recordGateOf(opts.gate, plan),
        compression: plan.compression || '',
        totalParts: plan.totalParts,
        totalBytes: plan.totalBytes,
        partCapacity: plan.partCapacity,
        approvedRate: rate,
        fundingOutputs: quote.outputs,
        linkTarget: opts.linkTarget || null,
    });
    await opts.vault.pendingFileUploads.put(record);
    return record;
}

async function resumeRecord(opts) {
    if (!opts.resumeId) return null;
    const record = await opts.vault.pendingFileUploads.get(opts.resumeId);
    if (!record) throw new Error(`publishMultipartFile: no pending upload "${opts.resumeId}"`);
    return record;
}

function planningGate(opts, record) {
    if (!record) return opts.gate || null;
    if (record.gate === null) return null;
    return resumeGateOf(record.gate, opts.gate?.key);
}

async function recordForRun(opts, record, source, plan, quote, rate, originalSha256, config) {
    if (!opts.resumeId) {
        return initialRecord(opts, source, plan, quote, rate, originalSha256, config);
    }
    if (record.originalSha256 !== originalSha256) {
        const error = new Error('Resume pick does not match the original file.');
        error.code = 'RESUME_ORIGINAL_MISMATCH';
        throw error;
    }
    confirmResumePick(record, {
        fileHash: plan.fileHash,
        totalParts: plan.totalParts,
        sourceAddress: source.address,
    });
    const manifest = record.wave?.pieces.find((piece) => piece.index === -1);
    return {
        ...record,
        manifestActionIndex: record.manifestActionIndex ?? manifest?.actionIndex ?? null,
        manifestTxid: record.manifestTxid ?? manifest?.txid ?? null,
    };
}

function partSourceFor(opts) {
    if (opts.partSource) return opts.partSource;
    if (opts.bytes instanceof Uint8Array) return bytesPartSource(opts.bytes);
    return null;
}

function waveFor(plan, quote, index) {
    const range = multipartWaveRanges(plan.totalParts)[index];
    if (!range) return null;
    const pieces = Array.from({ length: range.to - range.from + 1 }, (_unused, offset) => ({
        index: range.from + offset - 1,
        signedTxids: [],
        txid: null,
        actionIndex: null,
    }));
    return {
        index,
        fundingTxid: null,
        fundingOutputs: quote.outputs.slice(range.from, range.to + 1),
        pieces,
    };
}

function runConfig(opts, record) {
    if (record?.lane) {
        return { lane: record.lane, buildMode: record.buildMode, meta: record.meta };
    }
    return { ...laneConfig(opts), meta: opts.meta || {} };
}

async function prepareRun(opts, source, sdk) {
    const savedRecord = await resumeRecord(opts);
    const config = runConfig(opts, savedRecord);
    const effectiveOpts = withManifestActionData({ ...opts, ...config }, sdk, source);
    const gate = planningGate(effectiveOpts, savedRecord);
    const partSource = partSourceFor(opts);
    let plan;
    let streamed = false;
    if (gate !== null || opts.planMultipartFile) {
        const planner = opts.planMultipartFile || planMultipartFile;
        plan = await planner(opts.bytes, config.meta, { carrier: config.lane, gate });
    } else {
        const planner = opts.planMultipartStream || planMultipartStream;
        plan = await planner(partSource, config.meta, { carrier: config.lane });
        streamed = true;
    }
    const rate = savedRecord?.approvedRate ?? await feeRate(opts, sdk);
    const quote = quoteFor(opts, plan, rate, config.lane);
    const originalSha256 = plan.originalSha256
        ?? bytesToHex(sha256(opts.bytes));
    const record = await recordForRun(
        effectiveOpts, savedRecord, source, plan, quote, rate, originalSha256, config,
    );
    return {
        config,
        effectiveOpts,
        partSource: streamed ? partSource : null,
        plan,
        quote,
        rate,
        record,
    };
}

function assertInputs(opts) {
    if (!opts?.vault?.pendingFileUploads) throw new Error('publishMultipartFile: vault is required');
    if (!opts.sdkRegistry) throw new Error('publishMultipartFile: sdkRegistry is required');
    if (!opts.signer) throw new Error('publishMultipartFile: signer is required');
    const hasBytes = opts.bytes instanceof Uint8Array && opts.bytes.length > 0;
    const hasPartSource = opts.partSource && Number.isSafeInteger(opts.partSource.size)
        && opts.partSource.size > 0 && typeof opts.partSource.readSlice === 'function';
    if (!hasBytes && !hasPartSource) {
        throw new Error('publishMultipartFile: bytes or partSource are required');
    }
    if (opts.gate && !hasBytes) {
        throw new Error('publishMultipartFile: gated uploads require bytes');
    }
}

function withManifestActionData(opts, sdk, source) {
    if (!opts.gate?.key || typeof opts.manifestActionData === 'function') return opts;
    const descriptor = opts.chainRegistry?.get?.(opts.chainId);
    const coin = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : null;
    if (!coin) {
        throw new Error(`publishMultipartFile: cannot resolve protocol coin ticker for ${opts.chainId}`);
    }
    return {
        ...opts,
        manifestActionData: gatedManifestActionData({
            sdk,
            key: opts.gate.key,
            publicKey: source.publicKey,
            coin,
            sourceAddress: source.address,
        }),
    };
}

export async function publishMultipartFile(opts) {
    assertInputs(opts);
    const sourceInput = opts.from || opts.source || {
        address: opts.sourceAddress,
        publicKey: opts.publicKey,
        derivationPath: opts.derivationPath,
        addressId: opts.addressId,
    };
    const source = normalizeSource(sourceInput, 'publishMultipartFile');
    const sdk = opts.sdkRegistry.get(opts.chainId);
    const tip = await chainTipBlockTime({
        sdkRegistry: opts.sdkRegistry, chainId: opts.chainId, withProtocolTime: true,
    });
    assertMultipartActive({
        chainId: opts.chainId,
        tip,
        activationTimes: opts.activationTimes || FILE_MULTIPART_ACTIVATION_TIME,
    });
    const run = await prepareRun(opts, source, sdk);
    const { config, partSource, plan, quote, rate } = run;
    let { record } = run;
    const save = async (next) => opts.vault.pendingFileUploads.put(next);
    const waitForTxid = opts.waitForTxid
        || ((txid, waitOpts) => sdk.waitForAction(txid, waitOpts));
    const ctx = {
        opts: run.effectiveOpts, sdk, source, lane: config.lane, buildMode: config.buildMode,
        partSource, plan, rate, record, save, waitForTxid,
        signer: opts.signer, chainId: opts.chainId,
    };
    const totalWaves = multipartWaveCount(plan.totalParts);
    while (ctx.record.wavesDone < totalWaves) {
        const waveIndex = ctx.record.wavesDone;
        if (!ctx.record.wave || ctx.record.wave.index !== waveIndex) {
            ctx.record = { ...ctx.record, wave: waveFor(plan, quote, waveIndex) };
            await ctx.save(ctx.record);
        }
        if (!ctx.record.wave.fundingTxid) {
            const values = quote.outputs.slice(
                multipartWaveRanges(plan.totalParts)[waveIndex].from,
                multipartWaveRanges(plan.totalParts)[waveIndex].to + 1,
            );
            await fundUpload(ctx, values);
        }
        const hasProgress = ctx.record.wave.pieces.some((piece) => (
            piece.txid || piece.signedTxids.length > 0 || piece.actionIndex
        ));
        const sendPlan = opts.resumeId && hasProgress
            ? await resumePlan(ctx)
            : { send: ctx.record.wave.pieces.map((piece) => piece.index), wait: [] };
        await sendAndIndex(ctx, sendPlan);
        ctx.record = { ...ctx.record, wavesDone: waveIndex + 1 };
        progress(ctx.opts, 'wave-confirmed', { wave: waveIndex, waves: totalWaves });
        await ctx.save(ctx.record);
        if (ctx.record.wavesDone < totalWaves) {
            ctx.record = {
                ...ctx.record,
                wave: waveFor(plan, quote, ctx.record.wavesDone),
            };
            await ctx.save(ctx.record);
        }
    }
    if (ctx.record.stage === 'sending') {
        ctx.record = advanceUploadStage(ctx.record, 'assembling');
        ctx.record = { ...ctx.record, wave: null };
        await ctx.save(ctx.record);
    }
    const { multipart, manifest } = await finishAssembly(ctx);
    return {
        record: ctx.record,
        pendingFileUploadId: ctx.record.id,
        fileId: manifest.actionIndex,
        txid: manifest.txid,
        multipart,
        quote,
    };
}

export { filePieceMayBeOnChain };
