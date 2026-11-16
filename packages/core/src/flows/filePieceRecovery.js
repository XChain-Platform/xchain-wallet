// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

export const FILE_RECORD_SAVE_FAILED = 'FILE_RECORD_SAVE_FAILED';
export const FILE_PIECE_TXID_CONFLICT = 'FILE_PIECE_TXID_CONFLICT';

function codedError(code, message, cause) {
    const error = new Error(message, cause === undefined ? undefined : { cause });
    error.code = code;
    return error;
}

function assertLane(lane) {
    if (lane !== 'envelope' && lane !== 'standard') {
        throw new TypeError(`Unknown file piece lane: ${String(lane)}`);
    }
}

function revealTxidOf(revealPlan) {
    if (typeof revealPlan === 'string') return revealPlan;
    return revealPlan?.txid ?? revealPlan?.revealTxid;
}

function sameValues(left, right) {
    return Array.isArray(left)
        && Array.isArray(right)
        && left.length === right.length
        && left.every((value, position) => value === right[position]);
}

/**
 * Build the ordered data needed to identify or rebuild a signed piece.
 *
 * @param {{ lane: 'envelope'|'standard', signedCommitHex: string, commitTxid: string, revealPlan: object|string }} args
 * @returns {string[]}
 */
export function recoveryRecordFor({ lane, signedCommitHex, commitTxid, revealPlan }) {
    assertLane(lane);
    const revealTxid = revealTxidOf(revealPlan);
    return lane === 'envelope'
        ? [commitTxid, revealTxid]
        : [signedCommitHex, commitTxid, revealTxid];
}

/**
 * Persist a piece's signed transaction identities before any broadcast.
 *
 * @param {{ record: object, index: number, lane: 'envelope'|'standard', signedTxids: string[], save: (record: object) => Promise<void> }} args
 * @returns {Promise<object>}
 */
export async function recordPieceBeforeBroadcast({ record, index, lane, signedTxids, save }) {
    assertLane(lane);
    const pieces = Array.isArray(record?.pieces) ? record.pieces : [];
    const position = pieces.findIndex((piece) => piece?.index === index);
    if (position < 0) throw new RangeError(`No file piece has index ${index}`);

    const existing = pieces[position].signedTxids;
    if (Array.isArray(existing) && existing.length > 0 && !sameValues(existing, signedTxids)) {
        throw codedError(
            FILE_PIECE_TXID_CONFLICT,
            `File piece ${index} already has different signed transaction data`,
        );
    }

    const nextPieces = pieces.slice();
    nextPieces[position] = { ...pieces[position], signedTxids: [...signedTxids] };
    const nextRecord = { ...record, pieces: nextPieces };
    try {
        await save(nextRecord);
    } catch (cause) {
        throw codedError(
            FILE_RECORD_SAVE_FAILED,
            `Could not save signed transaction data for file piece ${index}`,
            cause,
        );
    }
    return nextRecord;
}
