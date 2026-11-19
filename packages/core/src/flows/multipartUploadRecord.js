// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import {
    MULTIPART_FILE_MAX_BYTES,
    MULTIPART_FILE_MAX_PARTS,
} from './fileSizeLimits.js';

export const FILE_UPLOAD_RECORD_INVALID = 'FILE_UPLOAD_RECORD_INVALID';
export const FILE_UPLOAD_FUNDING_INVALID = 'FILE_UPLOAD_FUNDING_INVALID';
export const FILE_UPLOAD_STAGE_INVALID = 'FILE_UPLOAD_STAGE_INVALID';

const STAGES = ['funding', 'sending', 'assembling', 'complete', 'mismatch'];
const DIGEST = /^[0-9a-f]{64}$/i;
const POSITIVE_DECIMAL = /^[1-9]\d*$/;

function invalid(code, field, detail) {
    const error = new Error(`${field}: ${detail}`);
    error.code = code;
    return error;
}

function requireRecord(condition, field, detail) {
    if (!condition) throw invalid(FILE_UPLOAD_RECORD_INVALID, field, detail);
}

function copyObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : value;
}

function validLinkTarget(value) {
    if (value === null) return true;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (typeof value.tick !== 'string' || value.tick.trim().length === 0) return false;
    const index = value.issueActionIndex;
    if (typeof index === 'number') return Number.isSafeInteger(index) && index > 0;
    return typeof index === 'string' && POSITIVE_DECIMAL.test(index);
}

function validatePlan(input) {
    for (const field of ['id', 'walletId', 'chainId', 'sourceAddress']) {
        requireRecord(typeof input?.[field] === 'string' && input[field].trim().length > 0,
            field, 'must be a non-empty string');
    }
    for (const field of ['originalSha256', 'fileHash']) {
        requireRecord(typeof input[field] === 'string' && DIGEST.test(input[field]),
            field, 'must be 64 hexadecimal characters');
    }
    requireRecord(
        Number.isInteger(input.totalParts)
            && input.totalParts >= 2 && input.totalParts <= MULTIPART_FILE_MAX_PARTS,
        'totalParts', `must be an integer from 2 to ${MULTIPART_FILE_MAX_PARTS}`,
    );
    requireRecord(
        Number.isInteger(input.totalBytes)
            && input.totalBytes >= 1 && input.totalBytes <= MULTIPART_FILE_MAX_BYTES,
        'totalBytes', `must be an integer from 1 to ${MULTIPART_FILE_MAX_BYTES}`,
    );
    requireRecord(Array.isArray(input.partDigests), 'partDigests', 'must be an array');
    requireRecord(input.partDigests.length === input.totalParts,
        'partDigests', 'length must equal totalParts');
    for (let index = 0; index < input.partDigests.length; index += 1) {
        const digest = input.partDigests[index];
        requireRecord(typeof digest === 'string' && DIGEST.test(digest),
            `partDigests[${index}]`, 'must be 64 hexadecimal characters');
    }
    requireRecord(validLinkTarget(input.linkTarget), 'linkTarget', 'must be null or a valid link target');
    requireRecord(Number.isFinite(input.createdAt), 'createdAt', 'must be finite');
}

function initialPieces(totalParts) {
    const pieces = Array.from({ length: totalParts }, (_, index) => ({
        index,
        signedTxids: [],
        txid: null,
        actionIndex: null,
    }));
    pieces.push({ index: -1, signedTxids: [], txid: null, actionIndex: null });
    return pieces;
}

export function newPendingFileUpload(input) {
    validatePlan(input);
    return {
        id: input.id,
        walletId: input.walletId,
        chainId: input.chainId,
        sourceAddress: input.sourceAddress,
        originalSha256: input.originalSha256.toLowerCase(),
        fileHash: input.fileHash.toLowerCase(),
        meta: copyObject(input.meta),
        gate: copyObject(input.gate),
        compression: input.compression,
        totalParts: input.totalParts,
        totalBytes: input.totalBytes,
        partDigests: input.partDigests.map((digest) => digest.toLowerCase()),
        fundingTxid: null,
        fundingOutputs: [],
        pieces: initialPieces(input.totalParts),
        stage: 'funding',
        linkTarget: copyObject(input.linkTarget),
        createdAt: input.createdAt,
    };
}

function validateFundingOutput(output, index, fundingTxid) {
    const field = `fundingOutputs[${index}]`;
    if (!output || typeof output !== 'object' || Array.isArray(output)) {
        throw invalid(FILE_UPLOAD_FUNDING_INVALID, field, 'must be an output object');
    }
    if (output.txid !== fundingTxid) {
        throw invalid(FILE_UPLOAD_FUNDING_INVALID, `${field}.txid`, 'must equal fundingTxid');
    }
    if (!Number.isSafeInteger(output.vout) || output.vout < 0) {
        throw invalid(FILE_UPLOAD_FUNDING_INVALID, `${field}.vout`, 'must be a non-negative safe integer');
    }
    if (!Number.isSafeInteger(output.value) || output.value < 0) {
        throw invalid(FILE_UPLOAD_FUNDING_INVALID, `${field}.value`, 'must be a non-negative safe integer');
    }
    if (typeof output.scriptPubKey !== 'string' || output.scriptPubKey.length === 0) {
        throw invalid(FILE_UPLOAD_FUNDING_INVALID, `${field}.scriptPubKey`, 'must be a non-empty string');
    }
}

export function withFunding(record, funding) {
    const wave = record?.wave;
    if (wave && !['funding', 'sending'].includes(record?.stage)) {
        throw invalid(FILE_UPLOAD_FUNDING_INVALID, 'stage', 'must be funding or sending');
    }
    if (!wave && record?.stage !== 'funding') {
        throw invalid(FILE_UPLOAD_FUNDING_INVALID, 'stage', 'must be funding');
    }
    const fundingTxid = funding?.fundingTxid;
    if (typeof fundingTxid !== 'string' || !DIGEST.test(fundingTxid)) {
        throw invalid(FILE_UPLOAD_FUNDING_INVALID, 'fundingTxid', 'must be 64 hexadecimal characters');
    }
    const outputs = funding?.fundingOutputs;
    const pieces = wave?.pieces ?? record.pieces;
    if (!Array.isArray(outputs) || outputs.length !== pieces.length) {
        throw invalid(FILE_UPLOAD_FUNDING_INVALID, 'fundingOutputs', 'must contain one output per piece');
    }
    for (let index = 0; index < outputs.length; index += 1) {
        validateFundingOutput(outputs[index], index, fundingTxid);
    }
    const fundingOutputs = outputs.map((output) => ({ ...output }));
    return wave
        ? { ...record, wave: { ...wave, fundingTxid, fundingOutputs } }
        : { ...record, fundingTxid, fundingOutputs };
}

function hasEveryPieceTxid(record) {
    if (!Array.isArray(record.pieces) || record.pieces.length !== record.totalParts + 1) return false;
    const indexes = new Set(record.pieces.map((piece) => piece?.index));
    if (!indexes.has(-1)) return false;
    for (let index = 0; index < record.totalParts; index += 1) {
        if (!indexes.has(index)) return false;
    }
    return record.pieces.every((piece) => (
        typeof piece?.txid === 'string' && piece.txid.trim().length > 0
    ));
}

function stageError(current, next, detail) {
    throw invalid(FILE_UPLOAD_STAGE_INVALID, `${String(current)} -> ${String(next)}`, detail);
}

export function advanceUploadStage(record, next) {
    const current = record?.stage;
    if (!STAGES.includes(current) || !STAGES.includes(next)) {
        stageError(current, next, 'unknown stage');
    }
    if (current === next) return { ...record };
    if (current === 'complete' || current === 'mismatch') {
        stageError(current, next, 'terminal stage cannot advance');
    }
    if (current === 'funding' && next === 'sending') {
        const fundingTxid = record.wave?.fundingTxid ?? record.fundingTxid;
        if (typeof fundingTxid !== 'string' || fundingTxid.trim().length === 0) {
            stageError(current, next, 'fundingTxid is not set');
        }
        return { ...record, stage: next };
    }
    if (current === 'sending' && next === 'assembling') {
        const complete = record.wave
            ? record.wave.pieces.every((piece) => typeof piece?.txid === 'string'
                && piece.txid.trim().length > 0)
                && record.wavesDone === Math.ceil((record.totalParts + 1) / 100)
            : hasEveryPieceTxid(record);
        if (!complete) stageError(current, next, 'every piece must have a txid');
        return { ...record, stage: next };
    }
    if (current === 'assembling' && (next === 'complete' || next === 'mismatch')) {
        return { ...record, stage: next };
    }
    return stageError(current, next, 'stage move is not allowed');
}
