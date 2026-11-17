// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

export const UPLOAD_BLOB_RELEASE_STAGES = Object.freeze(['complete', 'mismatch']);

export function releasesUploadBlob(stage) {
    return UPLOAD_BLOB_RELEASE_STAGES.includes(stage);
}

export async function releaseUploadBlob(fileBlobs, id) {
    if (typeof id !== 'string' || id.length === 0) {
        const error = new TypeError('Upload blob id must be a non-empty string');
        error.code = 'UPLOAD_BLOB_RELEASE_INVALID';
        throw error;
    }
    if (typeof fileBlobs?.remove !== 'function') return false;
    await fileBlobs.remove(id);
    return true;
}
