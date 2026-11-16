// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { MULTIPART_FILE_MAX_BYTES } from './fileSizeLimits.js';

function invalid(field) {
    const error = new TypeError(`${field} is invalid`);
    error.code = 'FILE_UPLOAD_PATH_INVALID';
    return error;
}

function validateSupport(support) {
    if (!support || typeof support !== 'object' || Array.isArray(support)) {
        throw invalid('support');
    }
    if (support.supported === true) {
        if (!['envelope', 'standard'].includes(support.lane)) throw invalid('support.lane');
        if (typeof support.buildMode !== 'string' || support.buildMode.trim() === '') {
            throw invalid('support.buildMode');
        }
        return;
    }
    if (support.supported !== false) throw invalid('support.supported');
    if (typeof support.reason !== 'string' || support.reason.trim() === '') {
        throw invalid('support.reason');
    }
}

export function chooseFileUploadPath({ byteLength, singleTransactionCap, support } = {}) {
    if (!Number.isSafeInteger(byteLength) || byteLength <= 0) throw invalid('byteLength');
    if (!Number.isSafeInteger(singleTransactionCap) || singleTransactionCap <= 0) {
        throw invalid('singleTransactionCap');
    }
    validateSupport(support);

    const maxBytes = support.supported
        ? Math.max(singleTransactionCap, MULTIPART_FILE_MAX_BYTES)
        : singleTransactionCap;
    if (byteLength <= singleTransactionCap) return { path: 'single', maxBytes };
    if (!support.supported) {
        return { path: 'refused', reason: support.reason, maxBytes };
    }
    if (byteLength > MULTIPART_FILE_MAX_BYTES) {
        return { path: 'refused', reason: 'too_large', maxBytes };
    }
    return {
        path: 'multipart', lane: support.lane, buildMode: support.buildMode, maxBytes,
    };
}
