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
import { multipartTransactionCount } from './multipartWaves.js';

function invalid(field) {
    const error = new Error(`multipartPublishResult: invalid ${field}`);
    error.code = 'MULTIPART_RESULT_INVALID';
    return error;
}

function requireInteger(value, field, minimum, maximum) {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
        throw invalid(field);
    }
    return value;
}

function actionIndex(value) {
    if (typeof value === 'number') {
        requireInteger(value, 'fileId', 1, Infinity);
        return BigInt(value).toString();
    }
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
        throw invalid('fileId');
    }
    return value;
}

function gatedKeyHash(upload) {
    return upload?.gated === true
        && typeof upload.keyHash === 'string'
        && /^[0-9a-f]{64}$/.test(upload.keyHash)
        ? upload.keyHash
        : null;
}

export function multipartPublishResult(reply, { originalBytes } = {}) {
    if (reply?.multipart?.status !== 'complete') throw invalid('multipart.status');
    const manifestActionIndex = actionIndex(reply.fileId);
    if (typeof reply.txid !== 'string' || !/^[0-9a-f]{64}$/.test(reply.txid)) {
        throw invalid('txid');
    }
    const totalParts = requireInteger(
        reply.multipart.total_parts, 'multipart.total_parts', 2, MULTIPART_FILE_MAX_PARTS,
    );
    const totalBytes = requireInteger(
        reply.multipart.total_bytes, 'multipart.total_bytes', 1, MULTIPART_FILE_MAX_BYTES,
    );
    requireInteger(originalBytes, 'originalBytes', 1, Infinity);
    return {
        actionIndex: manifestActionIndex,
        txid: reply.txid,
        totalParts,
        totalBytes,
        transactions: multipartTransactionCount(totalParts),
        keyHash: gatedKeyHash(reply.upload),
        compression: reply.upload?.gated === true ? null : {
            rawLength: originalBytes,
            storedLength: totalBytes,
            compressed: totalBytes !== originalBytes,
        },
    };
}
