// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const manifest = JSON.parse(readFileSync(
    resolve(repo, 'packages/extension/manifest.json'),
    'utf8',
));
const sourceRoot = resolve(repo, 'packages/extension/src');
const sourceExtensions = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx']);

function sourceFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return sourceExtensions.has(extname(entry.name)) ? [path] : [];
    });
}

const executableSource = sourceFiles(sourceRoot)
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const permissionApis = {
    alarms: /(?:chrome|globalThis\.chrome)\??\.alarms\b/,
    notifications: /(?:chrome|globalThis\.chrome)\??\.notifications\b/,
    sidePanel: /(?:chrome|globalThis\.chrome)\??\.sidePanel\b/,
    storage: /(?:chrome|globalThis\.chrome)\??\.storage\b/,
};

for (const permission of manifest.permissions || []) {
    assert.ok(
        Object.hasOwn(permissionApis, permission),
        `permission ${JSON.stringify(permission)} needs an API reference rule`,
    );
    assert.match(
        executableSource,
        permissionApis[permission],
        `permission ${JSON.stringify(permission)} is not referenced by extension source`,
    );
}

assert.deepEqual(
    manifest.host_permissions || [],
    [],
    'the extension needs no host permissions beyond its declared content-script matches',
);

console.log(`OK: all ${(manifest.permissions || []).length} extension permissions are referenced in code; host permissions remain empty`);
