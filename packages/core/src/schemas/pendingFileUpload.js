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
import { randomUUID } from '../util/uuid.js';

export const CURRENT_VERSION = 1;
export const MAX_FILE_PARTS = 32;
export const MAX_FILE_BYTES = 12_000_000;

export const PENDING_FILE_UPLOAD_STAGES = /** @type {const} */ ([
    'funding',
    'sending',
    'assembling',
    'complete',
    'mismatch',
]);

/** @typedef {{ index: number, signedTxids: string[], txid: string | null, actionIndex: string | null }} PendingFilePiece */
/** @typedef {{ tick: string, issueActionIndex: string }} PendingFileLinkTarget */

/**
 * @typedef {Object} PendingFileUpload
 * @property {1} schemaVersion
 * @property {string} id
 * @property {string} walletId
 * @property {string} chainId
 * @property {string} sourceAddress
 * @property {string} originalSha256
 * @property {string} fileHash
 * @property {Record<string, unknown>} meta
 * @property {'envelope' | 'standard' | null} [lane]
 * @property {string | null} [buildMode]
 * @property {Record<string, unknown> | null} gate
 * @property {string} compression
 * @property {number} totalParts
 * @property {number} totalBytes
 * @property {string[]} partDigests
 * @property {string | null} fundingTxid
 * @property {(number | string | Record<string, unknown>)[]} fundingOutputs
 * @property {PendingFilePiece[]} pieces
 * @property {typeof PENDING_FILE_UPLOAD_STAGES[number]} stage
 * @property {PendingFileLinkTarget | null} linkTarget
 * @property {string} createdAt
 */

function initialPieces(totalParts) {
    return Array.from({ length: totalParts + 1 }, (_, offset) => ({
        index: offset - 1,
        signedTxids: [],
        txid: null,
        actionIndex: null,
    }));
}

function cloneFundingOutput(output) {
    return isPlainObject(output) ? { ...output } : output;
}

/** @returns {PendingFileUpload} */
export function createPendingFileUpload(input) {
    return {
        schemaVersion: CURRENT_VERSION,
        id: randomUUID(),
        walletId: input.walletId,
        chainId: input.chainId,
        sourceAddress: input.sourceAddress,
        originalSha256: input.originalSha256,
        fileHash: input.fileHash,
        meta: { ...input.meta },
        lane: input.lane ?? null,
        buildMode: input.buildMode ?? null,
        gate: input.gate == null ? null : { ...input.gate },
        compression: input.compression,
        totalParts: input.totalParts,
        totalBytes: input.totalBytes,
        partDigests: [...input.partDigests],
        fundingTxid: null,
        fundingOutputs: input.fundingOutputs.map(cloneFundingOutput),
        pieces: initialPieces(input.totalParts),
        stage: 'funding',
        linkTarget: input.linkTarget == null ? null : { ...input.linkTarget },
        createdAt: new Date().toISOString(),
    };
}

const isDigest = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const isNullableString = (value) => value === null || isNonEmptyString(value);
const isFundingOutput = (value) => isPlainObject(value)
    || (Number.isSafeInteger(value) && value >= 0)
    || isNonEmptyString(value);

function isPiece(piece, expectedIndex) {
    return isPlainObject(piece)
        && piece.index === expectedIndex
        && isArray(piece.signedTxids)
        && piece.signedTxids.every(isNonEmptyString)
        && isNullableString(piece.txid)
        && isNullableString(piece.actionIndex);
}

function isPiecePlan(pieces, totalParts) {
    return isArray(pieces)
        && pieces.length === totalParts + 1
        && pieces.every((piece, offset) => isPiece(piece, offset - 1));
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
    check(errors, 'meta', isPlainObject(record.meta), 'must be an object');
    check(errors, 'lane', record.lane === undefined || record.lane === null
        || isOneOf(record.lane, ['envelope', 'standard']),
    'must be absent, null, envelope, or standard');
    check(errors, 'buildMode', record.buildMode === undefined || record.buildMode === null
        || isNonEmptyString(record.buildMode),
    'must be absent, null, or a non-empty string');
    check(errors, 'gate', record.gate === null || isPlainObject(record.gate),
        'must be null or an object');
    check(errors, 'compression', isString(record.compression), 'must be a string');
    check(errors, 'totalParts', Number.isInteger(record.totalParts)
        && record.totalParts >= 2 && record.totalParts <= MAX_FILE_PARTS,
    `must be an integer from 2 to ${MAX_FILE_PARTS}`);
    check(errors, 'totalBytes', Number.isInteger(record.totalBytes)
        && record.totalBytes > 0 && record.totalBytes <= MAX_FILE_BYTES,
    `must be an integer from 1 to ${MAX_FILE_BYTES}`);
    check(errors, 'partDigests', isArray(record.partDigests)
        && record.partDigests.length === record.totalParts
        && record.partDigests.every(isDigest),
    'must contain one lowercase sha256 digest per part');
}

function validateProgress(errors, record) {
    check(errors, 'fundingTxid', isNullableString(record.fundingTxid),
        'must be null or a non-empty string');
    check(errors, 'fundingOutputs', isArray(record.fundingOutputs)
        && record.fundingOutputs.length === record.totalParts + 1
        && record.fundingOutputs.every(isFundingOutput),
    'must contain one funding amount or output object per piece');
    check(errors, 'pieces', isPiecePlan(record.pieces, record.totalParts),
        'must contain manifest index -1 followed by every part index');
    check(errors, 'stage', isOneOf(record.stage, PENDING_FILE_UPLOAD_STAGES),
        `must be one of ${PENDING_FILE_UPLOAD_STAGES.join(', ')}`);
    check(errors, 'linkTarget', isLinkTarget(record.linkTarget),
        'must be null or a tick and issueActionIndex pair');
    check(errors, 'createdAt', isIsoTimestamp(record.createdAt), 'must be an ISO timestamp');
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
