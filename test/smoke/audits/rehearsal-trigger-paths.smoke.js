// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import {
    existsSync, readdirSync, readFileSync, statSync,
} from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { swapRequirement } from '../../../tools/release/rehearse.mjs';
import { isAllOsTriggerPath } from '../../../tools/release/rehearsal-matrix.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const core = join(root, 'packages/core/src');
const storage = join(core, 'storage');
const EXEMPT = new Map([
    ['packages/core/src/shared/utils/logConsole.js', 'logs failures without changing vault values'],
    ['packages/core/src/shared/utils/diagnosticText.js', 'formats diagnostic output only'],
]);

function jsFiles(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) out.push(...jsFiles(path));
        else if (name.endsWith('.js')) out.push(path);
    }
    return out;
}

function importedPath(importer, specifier) {
    const raw = resolve(dirname(importer), specifier);
    const candidates = extname(raw) ? [raw] : [`${raw}.js`, join(raw, 'index.js')];
    return candidates.find(existsSync) || null;
}

function storageImportGraph() {
    const queue = jsFiles(storage);
    const seen = new Set();
    const edges = [];
    const importPattern = /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/g;
    while (queue.length > 0) {
        const importer = queue.shift();
        if (seen.has(importer)) continue;
        seen.add(importer);
        for (const match of readFileSync(importer, 'utf8').matchAll(importPattern)) {
            const dependency = importedPath(importer, match[1]);
            if (!dependency || !dependency.startsWith(core)) continue;
            edges.push({ importer, dependency });
            if (!seen.has(dependency)) queue.push(dependency);
        }
    }
    return edges;
}

const edges = storageImportGraph();
const reached = new Set(edges.map(({ dependency }) => relative(root, dependency)));
for (const { importer, dependency } of edges) {
    const path = relative(root, dependency);
    if (path.startsWith('packages/core/src/storage/')) continue;
    assert.ok(isAllOsTriggerPath(path) || EXEMPT.has(path),
        `${relative(root, importer)} -> ${path} is outside the all-OS trigger paths`);
}
for (const [path, reason] of EXEMPT) {
    assert.ok(reason.trim(), `${path} exemption needs a reason`);
    assert.ok(reached.has(path), `${path} exemption is stale`);
}

const requirementFor = (path) => swapRequirement({
    repo: '.', tag: 'v0.337.1', previousTag: 'v0.337.0', run: () => path,
}).requirement;
for (const path of [
    'packages/core/src/crypto/aead.js',
    'packages/core/src/crypto/kdf.js',
    'packages/core/src/crypto/walletBlob.js',
    'packages/core/src/schemas/migrations.js',
    'packages/core/src/schemas/wallet.js',
]) {
    assert.equal(requirementFor(path), 'all-os', `${path} must require every OS`);
}
assert.equal(requirementFor('packages/web/src/App.jsx'), 'one-os');

console.log('rehearsal-trigger-paths.smoke.js: ok');
