// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const VALID_STAGES = new Set([
    'funding',
    'sending',
    'assembling',
    'complete',
    'mismatch',
]);

function invalidRecord(field) {
    const error = new Error(`Invalid multipart panel record field: ${field}`);
    error.code = 'FILE_PANEL_RECORD_INVALID';
    return error;
}

export function multipartPanelProps(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
        throw invalidRecord('record');
    }
    const { totalParts, stage, pieces } = record;
    if (!Number.isInteger(totalParts) || totalParts < 2 || totalParts > 32) {
        throw invalidRecord('totalParts');
    }
    if (!VALID_STAGES.has(stage)) throw invalidRecord('stage');
    if (!Array.isArray(pieces)) throw invalidRecord('pieces');

    for (const piece of pieces) {
        const index = piece?.index;
        if (!Number.isInteger(index) || index < -1 || index >= totalParts) {
            throw invalidRecord('pieces.index');
        }
    }

    const sentParts = pieces.filter(({ index, txid }) => (
        index >= 0 && typeof txid === 'string' && txid.length > 0
    )).length;
    return {
        totalParts,
        transactions: 1 + (2 * (totalParts + 1)),
        currentPart: Math.min(sentParts + 1, totalParts),
        stage,
    };
}
