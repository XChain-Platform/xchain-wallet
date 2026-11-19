// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The `picked` file-ref kind: resolves a token the preload registered to the
// file the user picked, and nothing else. The ref carries no path, so the page
// cannot aim main's file read at one.

import { pickedFileTokens } from './pickedFileTokens.js';
import { createPathFileRefKind, fileRefInvalidError } from './pathFileRefKind.js';

function assertPickedFileRef(ref) {
    if (
        !ref
        || ref.kind !== 'picked'
        || typeof ref.token !== 'string'
        || ref.token.length === 0
        || !Number.isSafeInteger(ref.size)
        || ref.size < 0
    ) {
        throw fileRefInvalidError();
    }
}

export function createPickedFileRefKind({
    tokens = pickedFileTokens,
    openPath = createPathFileRefKind(),
} = {}) {
    return async (ref) => {
        assertPickedFileRef(ref);

        // One error for every token failure, raised before the filesystem is touched.
        const entry = tokens.take(ref.token);
        if (!entry || entry.size !== ref.size) throw fileRefInvalidError();

        return openPath({ kind: 'path', path: entry.path, size: entry.size, mtimeMs: entry.mtimeMs });
    };
}
