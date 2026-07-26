// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PendingDeploy record (PC-38): crash-safe state for the CHUNKED DEPLOY
// flow, which is N+1 separate signed transactions (one DEPLOY v4 carrier
// per base64 slice, then one assembling DEPLOY v2/v3 carrying CODE_HASH).
// Every carrier costs a real miner fee, so an interrupted run must be
// RESUMABLE rather than restarted: without this record a user who closes
// the wallet after 4 of 6 chunks has spent 4 fees with nothing to show.
//
//   stage = 'chunking'    at least one carrier broadcast; more to go.
//   stage = 'assembling'  every carrier indexed valid; the assembling
//                          DEPLOY v2/v3 still needs signing.
//   stage = 'done'        assembling DEPLOY broadcast.
//
// Resume is safe because of two consensus rules (xchain-indexer
// actions/deploy.js): the assembler gathers chunks from THIS deployer for
// THIS code_hash recorded at a LOWER action_index, and it dedups by
// position with the lowest action_index winning. So a re-sent chunk is
// wasteful but never corrupting, and a chunk from an earlier partial run
// is reused by a later assembly.
//
// `sourceAddress` is therefore load-bearing, not informational: chunks are
// gathered per-deployer, so resuming from a DIFFERENT address silently
// orphans every chunk already paid for. The flow pins it.
//
// The record stores `chunks` as one entry per planned slice, carrying the
// txid and (once known) the on-chain action_index. `codeHash` is the group
// id; `code` is kept verbatim so a resumed session can re-derive the exact
// slices without asking the user to re-paste the source (and so the
// assembling leg can re-verify the plan it is completing).

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

export const PENDING_DEPLOY_STAGES = /** @type {const} */ ([
    'chunking',
    'assembling',
    'done',
]);

/**
 * @typedef {Object} PendingDeployChunk
 * @property {number} index            CHUNK_INDEX (0-based, matches the plan order)
 * @property {string | null} txid      broadcast txid, null until sent
 * @property {string | null} actionIndex  on-chain ACTION_INDEX once indexed valid
 */

/**
 * @typedef {Object} PendingDeploy
 * @property {1} schemaVersion
 * @property {string} id
 * @property {string} walletId
 * @property {string} chainId
 * @property {string} sourceAddress   consensus-load-bearing: chunks are gathered per-deployer
 * @property {string} codeHash        sha256(utf8(source)); the chunk-group id
 * @property {string} code            verbatim source, so a resume needs no re-paste
 * @property {number} totalChunks
 * @property {PendingDeployChunk[]} chunks
 * @property {Record<string, string>} assembleParams  the DEPLOY v2/v3 params for phase 2
 * @property {string | null} deployTxid
 * @property {string | null} contractActionIndex
 * @property {typeof PENDING_DEPLOY_STAGES[number]} stage
 * @property {string} createdAt
 * @property {string | null} name
 */

/**
 * @param {Object} input
 * @param {string} input.walletId
 * @param {string} input.chainId
 * @param {string} input.sourceAddress
 * @param {string} input.codeHash
 * @param {string} input.code
 * @param {number} input.totalChunks
 * @param {Record<string, string>} input.assembleParams
 * @param {string} [input.name]
 * @returns {PendingDeploy}
 */
export function createPendingDeploy(input) {
    return {
        schemaVersion: CURRENT_VERSION,
        id: randomUUID(),
        walletId: input.walletId,
        chainId: input.chainId,
        sourceAddress: input.sourceAddress,
        codeHash: input.codeHash,
        code: input.code,
        totalChunks: input.totalChunks,
        chunks: Array.from({ length: input.totalChunks }, (_, i) => ({
            index: i,
            txid: null,
            actionIndex: null,
        })),
        assembleParams: { ...input.assembleParams },
        deployTxid: null,
        contractActionIndex: null,
        stage: 'chunking',
        createdAt: new Date().toISOString(),
        name: input.name ?? null,
    };
}

const isNullableNonEmptyString = (v) => v === null || isNonEmptyString(v);

function isChunkEntry(c) {
    return isPlainObject(c)
        && Number.isInteger(c.index) && c.index >= 0
        && isNullableNonEmptyString(c.txid)
        && isNullableNonEmptyString(c.actionIndex);
}

export function validatePendingDeploy(record) {
    const errors = [];
    if (!check(errors, 'pendingDeploy', isPlainObject(record), 'must be an object'))
        return result(errors);
    const r = /** @type {PendingDeploy} */ (record);
    check(errors, 'schemaVersion', r.schemaVersion === CURRENT_VERSION, `must be ${CURRENT_VERSION}`);
    check(errors, 'id', isNonEmptyString(r.id), 'must be a non-empty string');
    check(errors, 'walletId', isNonEmptyString(r.walletId), 'must be a non-empty string');
    check(errors, 'chainId', isNonEmptyString(r.chainId), 'must be a non-empty string');
    check(errors, 'sourceAddress', isNonEmptyString(r.sourceAddress), 'must be a non-empty string');
    check(errors, 'codeHash', typeof r.codeHash === 'string' && /^[0-9a-f]{64}$/.test(r.codeHash),
        'must be a 64-char lowercase sha256 hex digest');
    check(errors, 'code', isNonEmptyString(r.code), 'must be a non-empty string');
    check(errors, 'totalChunks', Number.isInteger(r.totalChunks) && r.totalChunks > 0,
        'must be a positive integer');
    check(errors, 'chunks',
        isArray(r.chunks) && r.chunks.length === r.totalChunks && r.chunks.every(isChunkEntry),
        'must be an array of totalChunks chunk entries');
    check(errors, 'assembleParams', isPlainObject(r.assembleParams), 'must be an object');
    check(errors, 'deployTxid', isNullableNonEmptyString(r.deployTxid), 'must be null or a non-empty string');
    check(errors, 'contractActionIndex', isNullableNonEmptyString(r.contractActionIndex),
        'must be null or a non-empty string');
    check(errors, 'stage', isOneOf(r.stage, PENDING_DEPLOY_STAGES),
        `must be one of ${PENDING_DEPLOY_STAGES.join(', ')}`);
    check(errors, 'createdAt', isIsoTimestamp(r.createdAt), 'must be an ISO timestamp');
    check(errors, 'name', r.name === null || isString(r.name), 'must be null or a string');
    return result(errors);
}
