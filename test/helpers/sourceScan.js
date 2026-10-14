// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { globSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const fileLists = new Map();
const sources = new Map();

export function cachedGlob(root, pattern) {
    const absoluteRoot = resolve(root);
    const key = `${absoluteRoot}\0${pattern}`;
    if (!fileLists.has(key)) {
        const paths = globSync(pattern, { cwd: absoluteRoot })
            .sort()
            .map((relativePath) => ({
                path: join(absoluteRoot, relativePath),
                relativePath,
            }));
        fileLists.set(key, paths);
    }
    return fileLists.get(key);
}

export function cachedSource(path) {
    const absolutePath = resolve(path);
    if (!sources.has(absolutePath)) sources.set(absolutePath, readFileSync(absolutePath, 'utf8'));
    return sources.get(absolutePath);
}

export function cachedSourceFiles(root, pattern) {
    return cachedGlob(root, pattern).map((file) => ({
        ...file,
        source: cachedSource(file.path),
    }));
}
