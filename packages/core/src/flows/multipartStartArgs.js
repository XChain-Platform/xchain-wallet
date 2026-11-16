// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { fileMultipartRequest } from './fileMultipartRequest.js';

export function multipartStartArgs(args) {
    const request = fileMultipartRequest(args);
    const match = {
        chainId: args.chainId,
        sourceAddress: args.from.address,
        originalSha256: bytesToHex(sha256(args.bytes)),
    };
    return { request, match };
}
