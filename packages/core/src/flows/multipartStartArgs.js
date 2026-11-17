// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { fileMultipartRequest } from './fileMultipartRequest.js';

export function multipartStartArgs(args) {
    const wrappedFile = args.bytes?.file;
    const file = args.file ?? wrappedFile;
    const normalized = file
        ? { ...args, file, fileRef: args.fileRef ?? args.bytes?.fileRef, bytes: undefined }
        : args;
    const request = fileMultipartRequest(normalized);
    const originalSha256 = file
        ? (args.originalSha256 ?? args.bytes?.originalSha256 ?? request.fileRef?.key
            ?? `inline:${file.name ?? ''}:${file.size}`)
        : bytesToHex(sha256(args.bytes));
    const match = {
        chainId: args.chainId,
        sourceAddress: args.from.address,
        originalSha256,
    };
    return { request, match };
}
