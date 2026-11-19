// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { chooseFileUploadPath } from './fileUploadPath.js';
import { multipartStartArgs } from './multipartStartArgs.js';

function invalidFile(field) {
    const error = new TypeError(`${field} is invalid`);
    error.code = 'FILE_UPLOAD_START_INVALID';
    return error;
}

export function fileUploadStart({
    walletId, chainId, from, bytes, file, fileRef, originalSha256,
    meta, singleTransactionCap, support, linkTarget = null, gate = null, existingKeyHash, rate,
} = {}) {
    const hasBytes = bytes instanceof Uint8Array && bytes.byteLength > 0;
    const hasFile = Boolean(file && Number.isSafeInteger(file.size) && file.size > 0
        && typeof file.slice === 'function');
    if (hasBytes === hasFile) throw invalidFile(file === undefined ? 'bytes' : 'file');
    if (gate !== null && !hasBytes) throw invalidFile('file');
    const byteLength = hasFile ? file.size : bytes.byteLength;
    const path = chooseFileUploadPath({
        byteLength,
        singleTransactionCap,
        support,
        gated: gate !== null,
    });
    if (path.path !== 'multipart') return { ...path };
    const optionalKeyHash = existingKeyHash === undefined ? {} : { existingKeyHash };
    const { request, match } = multipartStartArgs({
        walletId,
        chainId,
        from,
        ...(hasFile ? { file, fileRef, originalSha256 } : { bytes }),
        meta,
        path,
        linkTarget,
        gate,
        rate,
        ...optionalKeyHash,
    });
    return { ...path, request, match };
}
