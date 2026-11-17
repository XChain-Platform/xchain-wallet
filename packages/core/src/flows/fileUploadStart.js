// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { chooseFileUploadPath } from './fileUploadPath.js';
import { multipartStartArgs } from './multipartStartArgs.js';

function invalidBytes() {
    const error = new TypeError('bytes is invalid');
    error.code = 'FILE_UPLOAD_START_INVALID';
    return error;
}

export function fileUploadStart({
    walletId, chainId, from, bytes, meta, singleTransactionCap, support,
    linkTarget = null, gate = null, existingKeyHash, rate,
} = {}) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw invalidBytes();
    const path = chooseFileUploadPath({
        byteLength: bytes.byteLength,
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
        bytes,
        meta,
        path,
        linkTarget,
        gate,
        rate,
        ...optionalKeyHash,
    });
    return { ...path, request, match };
}
