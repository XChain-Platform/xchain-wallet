// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { chooseFileUploadPath } from './fileUploadPath.js';
import { multipartStartArgs } from './multipartStartArgs.js';

function invalid(field, details = {}) {
    const error = new Error(`Invalid file resume request field: ${field}`);
    error.code = 'FILE_RESUME_REQUEST_INVALID';
    Object.assign(error, details);
    return error;
}

function validateEntry(entry, resumeId) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw invalid('entry');
    }
    if (typeof entry.id !== 'string' || entry.id.trim() === '' || entry.id !== resumeId) {
        throw invalid('entry.id');
    }
}

function requireMultipart(path) {
    if (path.path === 'multipart') return;
    const reason = typeof path.reason === 'string' && path.reason.trim() !== ''
        ? path.reason
        : 'single';
    throw invalid('path', { reason });
}

export function multipartResumeRequestBuilder({
    walletId, chainId, from, singleTransactionCap, support, gate = null, rate,
} = {}) {
    return function buildResumeRequest({ entry, bytes, resumeId } = {}) {
        validateEntry(entry, resumeId);
        const path = chooseFileUploadPath({
            byteLength: bytes?.byteLength,
            singleTransactionCap,
            support,
        });
        requireMultipart(path);
        if (entry.gated === true && gate == null) throw invalid('gate');
        return multipartStartArgs({
            walletId,
            chainId,
            from,
            bytes,
            path,
            resumeId,
            meta: { name: entry.name },
            linkTarget: entry.linkTarget,
            gate: entry.gated === true ? gate : null,
            rate,
        });
    };
}
