// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// pnpm settings live in TWO homes, and which one is read flips on a pnpm
// major. ( §8.)
//
// pnpm 9, the version pinned in `packageManager`, reads `pnpm.*` from the
// root package.json and ignores pnpm-workspace.yaml's equivalents. pnpm 10
// reverses it: it reads the workspace file and warns that the package.json
// field "is no longer read". NEITHER errors on the copy it ignores.
//
// So any disagreement between the two is a configuration change scheduled
// to fire, unannounced, on whatever day someone bumps pnpm. When this was
// found the two had really drifted:
//
//   - `axios` was pinned in package.json only, so an upgrade would have
//     dropped that override entirely.
//   - four pins (tar, ws, protobufjs, form-data) read `^X` in package.json
//     but uncapped `>=X` in the workspace file, so an upgrade would have
//     WIDENED four security pins into ranges that admit a future major.
//
// Neither would have failed a build or printed a warning. Hence this file:
// the two copies must be identical, and drift is a test failure, not a
// discovery someone makes later.
//
// Which copy is live today is not a matter of opinion: pnpm-lock.yaml
// records the overrides it actually resolved with, so it is checked here
// as the third witness.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

/**
 * Minimal reader for the flat `key: value` and `- item` shapes these two
 * blocks use. Deliberately not a YAML dependency: this file guards the
 * install configuration, so it must not need an install to be trustworthy.
 */
function parseBlocks(text) {
    const out = {};
    let key = null;
    for (const raw of text.split('\n')) {
        if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
        const top = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(raw);
        if (top) { key = top[1]; out[key] = top[2].trim() ? top[2].trim() : null; continue; }
        if (!key) continue;
        const item = /^\s+-\s+(.+?)\s*$/.exec(raw);
        if (item) {
            if (!Array.isArray(out[key])) out[key] = [];
            out[key].push(item[1].replace(/^['"]|['"]$/g, ''));
            continue;
        }
        const pair = /^\s+'?([^'\s:][^:]*?)'?:\s*'?(.+?)'?\s*$/.exec(raw);
        if (pair) {
            if (out[key] === null || typeof out[key] !== 'object') out[key] = {};
            out[key][pair[1]] = pair[2];
        }
    }
    return out;
}

const pkg = JSON.parse(read('package.json'));
const ws = parseBlocks(read('pnpm-workspace.yaml'));
const lock = parseBlocks(read('pnpm-lock.yaml'));

// ------------------------------------------------------------ overrides

{
    const a = pkg.pnpm?.overrides ?? {};
    const b = ws.overrides ?? {};

    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(),
        'package.json and pnpm-workspace.yaml pin the SAME set of overrides');

    for (const k of Object.keys(a)) {
        assert.equal(a[k], b[k],
            `override "${k}" has the same spec in both files `
            + `(package.json="${a[k]}", pnpm-workspace.yaml="${b[k]}")`);
    }

    // A security pin with no upper bound admits the next major, which is
    // the opposite of pinning. `vite` is the deliberate exception: it
    // carries its own explicit `<7` ceiling.
    for (const [k, spec] of Object.entries(a)) {
        if (spec.includes('<')) continue;
        assert.ok(!spec.trim().startsWith('>='),
            `override "${k}" is "${spec}": an uncapped >= lets a future major in silently`);
    }

    // Third witness: what pnpm actually resolved with.
    const live = lock.overrides ?? {};
    assert.deepEqual(Object.keys(live).sort(), Object.keys(a).sort(),
        'pnpm-lock.yaml resolved with exactly this override set '
        + '(if this fails, the lockfile predates the config change: re-run pnpm install)');
}

// ------------------------------------------------- onlyBuiltDependencies

{
    const a = pkg.pnpm?.onlyBuiltDependencies;
    const b = ws.onlyBuiltDependencies;

    assert.ok(Array.isArray(a) && a.length,
        'package.json declares an install-script allowlist (§8: scripts disabled or allowlisted)');
    assert.ok(Array.isArray(b) && b.length,
        'pnpm-workspace.yaml declares the same allowlist, so a pnpm 10 bump does not silently '
        + 're-enable install scripts for every dependency');

    assert.deepEqual([...a].sort(), [...b].sort(),
        'the allowlist is identical in both files');

    // Named explicitly rather than counted: adding an entry is a
    // supply-chain decision and should show up in a diff as one.
    assert.deepEqual([...a].sort(), [
        'electron',
        'electron-winstaller',
        'esbuild',
        'sharp',
        'tiny-secp256k1',
    ], 'the allowlist is exactly the packages that need to fetch or build a binary');
}

// The version this is all calibrated against. If someone bumps pnpm, the
// homes swap and this file's premise needs re-checking, so make the bump
// land here first.
{
    assert.ok(/^pnpm@9\./.test(pkg.packageManager || ''),
        `packageManager is pinned to pnpm 9.x (found "${pkg.packageManager}"). `
        + 'On a major bump, re-verify which config home pnpm reads before trusting either.');
}

console.log('pnpm-config-parity smoke: ok');
