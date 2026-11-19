// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { MULTIPART_FILE_MAX_PARTS } from './fileSizeLimits.js';
import { multipartTransactionCount } from './multipartWaves.js';

const VALID_STAGES = new Set([
    'funding',
    'sending',
    'assembling',
    'complete',
    'mismatch',
]);

const ACTIVE_STAGES = new Set(['funding', 'sending', 'assembling']);

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
    if (!Number.isInteger(totalParts) || totalParts < 2 || totalParts > MULTIPART_FILE_MAX_PARTS) {
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
        transactions: multipartTransactionCount(totalParts),
        currentPart: Math.min(sentParts + 1, totalParts),
        stage,
    };
}

export function summaryPanelProps(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw invalidRecord('entry');
    }
    const { totalParts, partsSent, stage } = entry;
    if (!Number.isInteger(totalParts) || totalParts < 2 || totalParts > MULTIPART_FILE_MAX_PARTS) {
        throw invalidRecord('totalParts');
    }
    if (!Number.isInteger(partsSent) || partsSent < 0 || partsSent > totalParts) {
        throw invalidRecord('partsSent');
    }
    if (!VALID_STAGES.has(stage)) throw invalidRecord('stage');

    return {
        totalParts,
        transactions: multipartTransactionCount(totalParts),
        currentPart: Math.min(partsSent + 1, totalParts),
        stage,
    };
}

function invalidMatch(field) {
    const error = new TypeError(`Invalid multipart panel match field: ${field}`);
    error.code = 'FILE_PANEL_MATCH_INVALID';
    return error;
}

function requireMatchField(value, field) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw invalidMatch(field);
    }
}

function createdAtMillis(entry) {
    const value = new Date(entry.createdAt).getTime();
    return Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value;
}

const SHA256_RE = /^[0-9a-f]{64}$/i;
const INLINE_KEY_PREFIX = 'inline:';
// A record written moments before the start's clock reading still counts.
const START_SKEW_MS = 5000;

/**
 * Whether an upload record is the one a start match names. A file held by
 * reference starts before its digest is known: its match carries the stored
 * blob key, which the route makes the record id, or an inline placeholder,
 * which matches any upload from that source created since the start.
 */
export function uploadMatchesKey(entry, match) {
    const key = match?.originalSha256;
    if (typeof key !== 'string' || !entry) return false;
    if (SHA256_RE.test(key)) {
        return typeof entry.originalSha256 === 'string'
            && entry.originalSha256.toLowerCase() === key.toLowerCase();
    }
    if (key.startsWith(INLINE_KEY_PREFIX)) {
        return !Number.isFinite(match.startedAt)
            || createdAtMillis(entry) >= match.startedAt - START_SKEW_MS;
    }
    return entry.id === key;
}

export function findActiveUpload(uploads, match) {
    if (!Array.isArray(uploads)) throw invalidMatch('uploads');
    const { chainId, sourceAddress, originalSha256 } = match ?? {};
    requireMatchField(chainId, 'chainId');
    requireMatchField(sourceAddress, 'sourceAddress');
    requireMatchField(originalSha256, 'originalSha256');

    let newest = null;
    for (const entry of uploads) {
        const matches = entry?.chainId === chainId
            && entry.sourceAddress === sourceAddress
            && uploadMatchesKey(entry, match)
            && ACTIVE_STAGES.has(entry.stage);
        if (matches && (newest === null || createdAtMillis(entry) > createdAtMillis(newest))) {
            newest = entry;
        }
    }
    return newest;
}
