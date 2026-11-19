// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Registers a file the preload resolved from a user-picked File. Answers an
// opaque token and the file's size, or null for anything that is not an
// absolute path to a regular file; the path itself is never sent back.

import fs from 'node:fs';
import path from 'node:path';

import { pickedFileTokens } from './pickedFileTokens.js';

/**
 * @param {unknown} filePath
 * @param {{ tokens?: ReturnType<typeof import('./pickedFileTokens.js').createPickedFileTokenStore>, stat?: typeof fs.promises.stat }} [deps]
 * @returns {Promise<{ token: string, size: number } | null>}
 */
export async function registerPickedFile(filePath, { tokens = pickedFileTokens, stat = fs.promises.stat } = {}) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return null;
    try {
        const fileStat = await stat(filePath);
        if (!fileStat.isFile() || !Number.isSafeInteger(fileStat.size)) return null;
        const token = tokens.issue({ path: filePath, size: fileStat.size, mtimeMs: fileStat.mtimeMs });
        return { token, size: fileStat.size };
    } catch {
        return null;
    }
}
