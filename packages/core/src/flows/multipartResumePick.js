// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';

const SHA256_RE = /^[0-9a-f]{64}$/i;

function invalid(field) {
    const error = new TypeError(`Invalid resume pick field: ${field}`);
    error.code = 'FILE_RESUME_PICK_INVALID';
    return error;
}

function validate({ entry, bytes, chainId, sourceAddress, gated }) {
    if (!entry || typeof entry !== 'object') throw invalid('entry');
    if (typeof entry.id !== 'string' || entry.id.trim() === '') throw invalid('entry.id');
    if (!SHA256_RE.test(entry.originalSha256)) throw invalid('entry.originalSha256');
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw invalid('bytes');
    if (typeof chainId !== 'string' || chainId.trim() === '') throw invalid('chainId');
    if (typeof sourceAddress !== 'string' || sourceAddress.trim() === '') {
        throw invalid('sourceAddress');
    }
    if (typeof gated !== 'boolean') throw invalid('gated');
}

export function checkResumePick({ entry, bytes, chainId, sourceAddress, gated }) {
    validate({ entry, bytes, chainId, sourceAddress, gated });
    if (entry.stage === 'complete' || entry.stage === 'mismatch') {
        return { ok: false, reason: 'not_resumable' };
    }
    if (entry.chainId !== chainId) return { ok: false, reason: 'chain_mismatch' };
    if (entry.sourceAddress !== sourceAddress) return { ok: false, reason: 'source_mismatch' };
    if (entry.gated !== gated) return { ok: false, reason: 'gate_mismatch' };
    const originalSha256 = bytesToHex(sha256(bytes));
    if (entry.originalSha256.toLowerCase() !== originalSha256) {
        return { ok: false, reason: 'file_mismatch' };
    }
    return { ok: true, resumeId: entry.id };
}
