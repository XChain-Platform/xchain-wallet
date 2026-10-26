// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The English dictionary is split by namespace under locales/en/: one file
// per namespace, each holding a `const messages = { ... };` literal, plus the
// index.js barrel that merges them. Source-reading tests and smokes read the
// namespace files through these helpers instead of one dictionary file.
// Resolved from this file's path when it is loaded from disk, so a smoke run
// from any directory finds the files. Path arithmetic rather than `new URL`,
// because jsdom test environments replace the global URL with one Node's
// fileURLToPath refuses. Vitest always runs from the wallet repo root, which
// the working-directory fallback covers.
function besideHelpersDir() {
    try {
        return resolve(dirname(fileURLToPath(import.meta.url)), '../../packages/core/src/i18n/locales/en');
    } catch {
        return null;
    }
}
const besideHelpers = besideHelpersDir();
export const EN_DIR = besideHelpers && existsSync(besideHelpers)
    ? besideHelpers
    : resolve(process.cwd(), 'packages/core/src/i18n/locales/en');

/** The files that hold English copy: every locales/en file but the barrel. */
export function englishNamespaceFiles() {
    return readdirSync(EN_DIR)
        .filter((name) => name.endsWith('.js') && name !== 'index.js')
        .sort()
        .map((name) => join(EN_DIR, name));
}

/** Each namespace file's name (without .js), path and source text. */
export function englishNamespaceSources() {
    return englishNamespaceFiles().map((file) => ({
        name: file.slice(EN_DIR.length + 1, -'.js'.length),
        file,
        source: readFileSync(file, 'utf8'),
    }));
}

/** Every namespace file's source, joined, for tests that match copy by text. */
export function englishDictionarySource() {
    return englishNamespaceSources().map(({ source }) => source).join('\n');
}

/**
 * The body of a namespace file's `const messages = { ... };` literal, or
 * null when the file does not keep that shape.
 */
export function messagesLiteral(source) {
    const open = source.indexOf('const messages = {');
    const close = source.indexOf('\n};', open);
    return open >= 0 && close > open ? source.slice(open, close) : null;
}
