// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { builtinModules } from 'node:module';
import {
    existsSync, readdirSync, readFileSync, statSync,
} from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolvedPackageEntries, swapRequirement } from '../../../tools/release/rehearse.mjs';
import {
    ALL_OS_TRIGGER_PACKAGES,
    ALL_OS_TRIGGER_PATHS,
    isAllOsTriggerPath,
} from '../../../tools/release/rehearsal-matrix.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const core = join(root, 'packages/core/src');
const storage = join(core, 'storage');
const EXEMPT = new Map([
    ['packages/core/src/shared/utils/logConsole.js', 'logs failures without changing vault values'],
    ['packages/core/src/shared/utils/diagnosticText.js', 'formats diagnostic output only'],
]);
const DESKTOP_PACKAGE_EXEMPT = new Map();

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

function packageName(specifier) {
    if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
    return specifier.split('/')[0];
}

function thirdPartyImports(path) {
    const source = readFileSync(path, 'utf8');
    const pattern = /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    const packages = new Set();
    for (const match of source.matchAll(pattern)) {
        const specifier = match[1] || match[2] || match[3];
        if (specifier.startsWith('.') || specifier.startsWith('node:')) continue;
        if (specifier.startsWith('@xchain-wallet/')) continue;
        if (builtinModules.includes(specifier)) continue;
        packages.add(packageName(specifier));
    }
    return packages;
}

function desktopTriggerPackages() {
    const found = new Map();
    const paths = ALL_OS_TRIGGER_PATHS.filter((path) => path.startsWith('packages/desktop/')
        && /\.(?:c|m)?js$/.test(path));
    for (const path of paths) {
        for (const name of thirdPartyImports(join(root, path))) {
            if (!found.has(name)) found.set(name, []);
            found.get(name).push(path);
        }
    }
    return found;
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

const desktopPackages = desktopTriggerPackages();
assert.ok(desktopPackages.has('openpgp'), 'the package scan must find the update signature verifier');
assert.ok(desktopPackages.has('electron-updater'), 'the package scan must find the dynamic updater import');
for (const [name, paths] of desktopPackages) {
    assert.ok(ALL_OS_TRIGGER_PACKAGES.includes(name) || DESKTOP_PACKAGE_EXEMPT.has(name),
        `${name} is imported by ${paths.join(', ')}; add it to ALL_OS_TRIGGER_PACKAGES or exempt it with a reason`);
}
for (const [name, reason] of DESKTOP_PACKAGE_EXEMPT) {
    assert.ok(reason.trim(), `${name} package exemption needs a reason`);
    assert.ok(desktopPackages.has(name), `${name} package exemption is stale`);
}

const liveLock = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8');
const livePins = resolvedPackageEntries(liveLock, ALL_OS_TRIGGER_PACKAGES);
const openpgpVersion = livePins.openpgp[0];
const bumpedLock = liveLock.split(`openpgp@${openpgpVersion}:`).join('openpgp@0.0.1-bumped:');
assert.notEqual(bumpedLock, liveLock, 'the fixture bump found the openpgp entry to rewrite');
const depOnly = ['pnpm-lock.yaml', 'packages/desktop/package.json'];
const lockRun = (_repo, args) => (args[0] === 'show'
    ? { 'v0.337.0': liveLock, 'v0.337.1': bumpedLock }[args[1].split(':')[0]]
    : depOnly.join('\n'));
const signatureBump = swapRequirement({
    repo: '.', tag: 'v0.337.1', previousTag: 'v0.337.0', run: lockRun,
});
assert.equal(signatureBump.requirement, 'all-os', 'an openpgp bump must be rehearsed on every OS');
assert.match(signatureBump.reason, /openpgp .* -> .*0\.0\.1-bumped/,
    'the reason names the signature verifier bump');

console.log('rehearsal-trigger-paths.smoke.js: ok');
