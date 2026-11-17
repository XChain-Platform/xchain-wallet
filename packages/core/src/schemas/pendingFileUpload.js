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
    check,
    isArray,
    isIsoTimestamp,
    isNonEmptyString,
    isOneOf,
    isPlainObject,
    isString,
    result,
} from './validate.js';
import {
    MULTIPART_FILE_MAX_BYTES,
    MULTIPART_FILE_MAX_PARTS,
    MULTIPART_FILE_PART_CAPACITY,
} from '../flows/fileSizeLimits.js';
import { randomUUID } from '../util/uuid.js';

export const CURRENT_VERSION = 2;
export const MAX_WAVE_PIECES = 100;

export const PENDING_FILE_UPLOAD_STAGES = /** @type {const} */ ([
    'funding',
    'sending',
    'assembling',
    'complete',
    'mismatch',
]);

/** @typedef {{ index: number, signedTxids: string[], txid: string | null, actionIndex: string | null }} PendingFilePiece */
/** @typedef {{ tick: string, issueActionIndex: string }} PendingFileLinkTarget */
/** @typedef {{ index: number, fundingTxid: string | null, fundingOutputs: unknown[], pieces: PendingFilePiece[] }} PendingFileWave */

/**
 * @typedef {Object} PendingFileUpload
 * @property {2} schemaVersion
 * @property {string} id
 * @property {string} walletId
 * @property {string} chainId
 * @property {string} sourceAddress
 * @property {Record<string, unknown>} meta
 * @property {'envelope' | 'standard' | null} lane
 * @property {string | null} buildMode
 * @property {Record<string, unknown> | null} gate
 * @property {string} compression
 * @property {number} totalParts
 * @property {number} totalBytes
 * @property {number | null} partCapacity
 * @property {string} fileHash
 * @property {string} originalSha256
 * @property {string | null} manifestActionIndex
 * @property {string | null} manifestTxid
 * @property {number | null} approvedRate
 * @property {number} wavesDone
 * @property {typeof PENDING_FILE_UPLOAD_STAGES[number]} stage
 * @property {PendingFileLinkTarget | null} linkTarget
 * @property {string | null} blobKey
 * @property {string | null} path
 * @property {string} createdAt
 * @property {PendingFileWave | null} wave
 */

function initialPieces(totalParts) {
    const count = Math.min(totalParts + 1, MAX_WAVE_PIECES);
    return Array.from({ length: count }, (_, offset) => ({
        index: offset - 1,
        signedTxids: [],
        txid: null,
        actionIndex: null,
    }));
}

function cloneFundingOutput(output) {
    return isPlainObject(output) ? { ...output } : output;
}

function clonePiece(piece) {
    return { ...piece, signedTxids: [...(piece.signedTxids || [])] };
}

function initialWave(input) {
    const pieces = initialPieces(input.totalParts);
    const outputs = isArray(input.fundingOutputs)
        ? input.fundingOutputs.slice(0, pieces.length).map(cloneFundingOutput)
        : [];
    return { index: 0, fundingTxid: null, fundingOutputs: outputs, pieces };
}

function cloneWave(wave) {
    if (wave === null) return null;
    return {
        index: wave.index,
        fundingTxid: wave.fundingTxid,
        fundingOutputs: (wave.fundingOutputs || []).map(cloneFundingOutput),
        pieces: (wave.pieces || []).map(clonePiece),
    };
}

/** @returns {PendingFileUpload} */
export function createPendingFileUpload(input) {
    const lane = input.lane ?? null;
    return {
        schemaVersion: CURRENT_VERSION,
        id: input.id ?? randomUUID(),
        walletId: input.walletId,
        chainId: input.chainId,
        sourceAddress: input.sourceAddress,
        meta: { ...input.meta },
        lane,
        buildMode: input.buildMode ?? null,
        gate: input.gate == null ? null : { ...input.gate },
        compression: input.compression,
        totalParts: input.totalParts,
        totalBytes: input.totalBytes,
        partCapacity: input.partCapacity ?? MULTIPART_FILE_PART_CAPACITY[lane] ?? null,
        fileHash: input.fileHash,
        originalSha256: input.originalSha256,
        manifestActionIndex: input.manifestActionIndex ?? null,
        manifestTxid: input.manifestTxid ?? null,
        approvedRate: input.approvedRate ?? null,
        wavesDone: input.wavesDone ?? 0,
        stage: input.stage ?? 'funding',
        linkTarget: input.linkTarget == null ? null : { ...input.linkTarget },
        blobKey: input.blobKey ?? null,
        path: input.path ?? null,
        createdAt: input.createdAt ?? new Date().toISOString(),
        wave: input.wave === undefined ? initialWave(input) : cloneWave(input.wave),
    };
}

const isDigest = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const isNullableString = (value) => value === null || isNonEmptyString(value);
const isFundingOutput = (value) => isPlainObject(value)
    || (Number.isSafeInteger(value) && value >= 0)
    || isNonEmptyString(value);

function isPiece(piece, totalParts) {
    return isPlainObject(piece)
        && Number.isInteger(piece.index)
        && piece.index >= -1
        && piece.index < totalParts
        && isArray(piece.signedTxids)
        && piece.signedTxids.every(isNonEmptyString)
        && isNullableString(piece.txid)
        && isNullableString(piece.actionIndex);
}

function isPieceWave(pieces, totalParts) {
    if (!isArray(pieces) || pieces.length === 0 || pieces.length > MAX_WAVE_PIECES) return false;
    if (!pieces.every((piece) => isPiece(piece, totalParts))) return false;
    return new Set(pieces.map((piece) => piece.index)).size === pieces.length;
}

function isLinkTarget(value) {
    return value === null || (isPlainObject(value)
        && isNonEmptyString(value.tick)
        && isNonEmptyString(value.issueActionIndex));
}

function validateIdentity(errors, record) {
    check(errors, 'schemaVersion', record.schemaVersion === CURRENT_VERSION,
        `must be ${CURRENT_VERSION}`);
    for (const field of ['id', 'walletId', 'chainId', 'sourceAddress']) {
        check(errors, field, isNonEmptyString(record[field]), 'must be a non-empty string');
    }
    check(errors, 'originalSha256', isDigest(record.originalSha256),
        'must be a 64-char lowercase sha256 hex digest');
    check(errors, 'fileHash', isDigest(record.fileHash),
        'must be a 64-char lowercase sha256 hex digest');
}

function validatePlan(errors, record) {
    check(errors, 'partDigests', !Object.hasOwn(record, 'partDigests'), 'must be absent');
    check(errors, 'meta', isPlainObject(record.meta), 'must be an object');
    check(errors, 'lane', record.lane === null || isOneOf(record.lane, ['envelope', 'standard']),
        'must be null, envelope, or standard');
    check(errors, 'buildMode', record.buildMode === null || isNonEmptyString(record.buildMode),
        'must be null or a non-empty string');
    check(errors, 'gate', record.gate === null || isPlainObject(record.gate),
        'must be null or an object');
    check(errors, 'compression', isString(record.compression), 'must be a string');
    check(errors, 'totalParts', Number.isInteger(record.totalParts)
        && record.totalParts >= 2 && record.totalParts <= MULTIPART_FILE_MAX_PARTS,
    `must be an integer from 2 to ${MULTIPART_FILE_MAX_PARTS}`);
    check(errors, 'totalBytes', Number.isSafeInteger(record.totalBytes)
        && record.totalBytes > 0 && record.totalBytes <= MULTIPART_FILE_MAX_BYTES,
    `must be an integer from 1 to ${MULTIPART_FILE_MAX_BYTES}`);
    check(errors, 'partCapacity', record.partCapacity === null
        || (Number.isSafeInteger(record.partCapacity) && record.partCapacity > 0),
    'must be null or a positive safe integer');
    check(errors, 'approvedRate', record.approvedRate === null
        || (Number.isFinite(record.approvedRate) && record.approvedRate > 0),
    'must be null or a positive number');
}

function validateWave(errors, record) {
    const wave = record.wave;
    if (wave === null) return;
    if (!check(errors, 'wave', isPlainObject(wave), 'must be null or an object')) return;
    check(errors, 'wave.index', Number.isSafeInteger(wave.index) && wave.index >= 0,
        'must be a non-negative safe integer');
    check(errors, 'wave.fundingTxid', isNullableString(wave.fundingTxid),
        'must be null or a non-empty string');
    const piecesValid = check(errors, 'wave.pieces', isPieceWave(wave.pieces, record.totalParts),
        `must contain 1 to ${MAX_WAVE_PIECES} unique valid pieces`);
    check(errors, 'wave.fundingOutputs', isArray(wave.fundingOutputs)
        && wave.fundingOutputs.length <= MAX_WAVE_PIECES
        && wave.fundingOutputs.every(isFundingOutput)
        && (!piecesValid || [0, wave.pieces.length].includes(wave.fundingOutputs.length)),
    'must be empty or contain one valid output per piece');
}

function validateProgress(errors, record) {
    const maxWaves = Math.ceil((record.totalParts + 1) / MAX_WAVE_PIECES);
    check(errors, 'wavesDone', Number.isSafeInteger(record.wavesDone)
        && record.wavesDone >= 0 && record.wavesDone <= maxWaves,
    'must be a valid completed wave count');
    check(errors, 'stage', isOneOf(record.stage, PENDING_FILE_UPLOAD_STAGES),
        `must be one of ${PENDING_FILE_UPLOAD_STAGES.join(', ')}`);
    check(errors, 'linkTarget', isLinkTarget(record.linkTarget),
        'must be null or a tick and issueActionIndex pair');
    check(errors, 'blobKey', record.blobKey === null || isNonEmptyString(record.blobKey),
        'must be null or a non-empty string');
    check(errors, 'path', record.path === null || isNonEmptyString(record.path),
        'must be null or a non-empty string');
    check(errors, 'source', !(isNonEmptyString(record.blobKey) && isNonEmptyString(record.path)),
        'must use blobKey or path, not both');
    check(errors, 'createdAt', isIsoTimestamp(record.createdAt), 'must be an ISO timestamp');
    check(errors, 'manifestActionIndex', record.manifestActionIndex === null
        || isNonEmptyString(record.manifestActionIndex),
    'must be null or a non-empty string');
    check(errors, 'manifestTxid', record.manifestTxid === null
        || isNonEmptyString(record.manifestTxid),
    'must be null or a non-empty string');
    validateWave(errors, record);
}

export function validatePendingFileUpload(record) {
    const errors = [];
    if (!check(errors, 'pendingFileUpload', isPlainObject(record), 'must be an object')) {
        return result(errors);
    }
    validateIdentity(errors, record);
    validatePlan(errors, record);
    validateProgress(errors, record);
    return result(errors);
}
