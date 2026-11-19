// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

const SHA256_RE = /^[0-9a-f]{64}$/i;

function resumeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function createdAtMillis(record) {
    const value = new Date(record.createdAt).getTime();
    return Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value;
}

export function findResumableUpload(records, { walletId, chainId, originalSha256 }) {
    if (typeof originalSha256 !== 'string' || !SHA256_RE.test(originalSha256)) {
        throw resumeError('RESUME_BAD_DIGEST', `Invalid resume digest: ${originalSha256}`);
    }

    const digest = originalSha256.toLowerCase();
    let newest = null;
    for (const record of records) {
        const matches = record.walletId === walletId
            && record.chainId === chainId
            && typeof record.originalSha256 === 'string'
            && record.originalSha256.toLowerCase() === digest;
        if (matches && (newest === null || createdAtMillis(record) > createdAtMillis(newest))) {
            newest = record;
        }
    }
    return newest;
}

export function confirmResumePick(record, { fileHash, totalParts, partCapacity, sourceAddress }) {
    const sameHash = typeof fileHash === 'string'
        && typeof record.fileHash === 'string'
        && fileHash.toLowerCase() === record.fileHash.toLowerCase();
    const sameCapacity = !Number.isSafeInteger(record.partCapacity)
        || !Number.isSafeInteger(partCapacity)
        || partCapacity === record.partCapacity;
    if (!sameHash || totalParts !== record.totalParts || !sameCapacity) {
        throw resumeError(
            'RESUME_PLAN_MISMATCH',
            `Resume plan mismatch: record hash ${record.fileHash}; picked hash ${fileHash}`,
        );
    }
    if (sourceAddress !== record.sourceAddress) {
        throw resumeError('RESUME_SOURCE_MISMATCH', 'Resume source address differs');
    }
    return true;
}
