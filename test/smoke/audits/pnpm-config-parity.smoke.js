// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// pnpm 11 reads dependency overrides and install-script policy from
// pnpm-workspace.yaml. Keeping those settings in package.json is misleading
// because pnpm warns that it ignores them.
//
// The `.npmrc` half is not a hypothetical either: the raise dropped all four
// of that file's settings at once, and the only symptom was six root-level
// test files failing to resolve `@scure/*` because the packages had moved into
// pnpm's private hoist directory. `supportedArchitectures` is the one with
// teeth beyond convenience - it decides which platform binaries are fetched at
// all, which is the input to this lane's two-arch matrix and to reproducibility
// being the same toolchain twice.
//
// pnpm-lock.yaml records the overrides it resolved with, so it remains a
// second witness for the authoritative workspace configuration.

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

/**
 * One level of nesting, for the only block here that has any:
 * `supportedArchitectures:` holds `os:` and `cpu:` lists. parseBlocks would
 * flatten those two lists into one array and the two homes would compare
 * equal while disagreeing, so this reads the sub-lists separately.
 */
function parseNestedLists(text, topKey) {
    const out = {};
    let inTop = false;
    let sub = null;
    for (const raw of text.split('\n')) {
        if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
        if (/^[A-Za-z]/.test(raw)) { inTop = new RegExp(`^${topKey}:\\s*$`).test(raw); sub = null; continue; }
        if (!inTop) continue;
        const subKey = /^\s{2}([A-Za-z][A-Za-z0-9_-]*):\s*$/.exec(raw);
        if (subKey) { sub = subKey[1]; out[sub] = []; continue; }
        const item = /^\s+-\s+(.+?)\s*$/.exec(raw);
        if (item && sub) out[sub].push(item[1].replace(/^['"]|['"]$/g, ''));
    }
    return out;
}

/** `key=value` lines, plus npm's `key.sub[]=value` repeated-list form. */
function parseNpmrc(text) {
    const flat = {};
    const lists = {};
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#') || line.startsWith(';')) continue;
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const key = line.slice(0, eq).trim();
        const value = line.slice(eq + 1).trim();
        const list = /^(.+)\[\]$/.exec(key);
        if (list) { (lists[list[1]] ||= []).push(value); continue; }
        flat[key] = value;
    }
    return { flat, lists };
}

const pkg = JSON.parse(read('package.json'));
const wsText = read('pnpm-workspace.yaml');
const ws = parseBlocks(wsText);
const lock = parseBlocks(read('pnpm-lock.yaml'));
const npmrc = parseNpmrc(read('.npmrc'));

// ------------------------------------------------------------ overrides

{
    const configured = ws.overrides ?? {};

    assert.equal(pkg.pnpm?.overrides, undefined,
        'dependency overrides belong only in pnpm-workspace.yaml because pnpm 11 ignores '
        + 'package.json pnpm.overrides');
    assert.ok(Object.keys(configured).length > 0,
        'pnpm-workspace.yaml declares dependency overrides');

    // A security pin with no upper bound admits the next major, which is
    // the opposite of pinning. `vite` is the deliberate exception: it
    // carries its own explicit `<7` ceiling.
    for (const [k, spec] of Object.entries(configured)) {
        if (spec.includes('<')) continue;
        assert.ok(!spec.trim().startsWith('>='),
            `override "${k}" is "${spec}": an uncapped >= lets a future major in silently`);
    }

    assert.equal(configured['ip-address'], '^10.5.1',
        'ip-address is pinned at the first release that fixes the advisory');

    // Second witness: what pnpm actually resolved with.
    const live = lock.overrides ?? {};
    assert.deepEqual(Object.keys(live).sort(), Object.keys(configured).sort(),
        'pnpm-lock.yaml resolved with exactly this override set '
        + '(if this fails, the lockfile predates the config change: re-run pnpm install)');

    assert.equal(configured['undici@7'], '^7.29.1',
        'undici 7.x is floored at the first release containing the security fix');
    assert.equal(live['undici@7'], configured['undici@7'],
        'pnpm-lock.yaml resolved with the undici 7.x security override');

    const undici7 = [...read('pnpm-lock.yaml').matchAll(/^  undici@(7\.\d+\.\d+):$/gm)]
        .map((match) => match[1]);
    assert.ok(undici7.length > 0, 'pnpm-lock.yaml contains an undici 7.x resolution');
    for (const version of undici7) {
        const [, minor, patch] = version.split('.').map(Number);
        assert.ok(minor > 29 || (minor === 29 && patch >= 1),
            `pnpm-lock.yaml resolves vulnerable undici ${version}`);
    }
}

// ------------------------------------------------- onlyBuiltDependencies

{
    const configured = ws.onlyBuiltDependencies;

    assert.equal(pkg.pnpm?.onlyBuiltDependencies, undefined,
        'the install-script allowlist belongs only in pnpm-workspace.yaml because pnpm 11 ignores '
        + 'package.json pnpm.onlyBuiltDependencies');
    assert.ok(Array.isArray(configured) && configured.length,
        'pnpm-workspace.yaml declares the install-script allowlist');

    // Named explicitly rather than counted: adding an entry is a
    // supply-chain decision and should show up in a diff as one.
    assert.deepEqual([...configured].sort(), [
        'electron',
        'electron-winstaller',
        'esbuild',
        'sharp',
        'tiny-secp256k1',
    ], 'the allowlist is exactly the packages that need to fetch or build a binary');
}

// ------------------------------------------------------------ allowBuilds
//
// The pnpm 11 form of the same allowlist. It is a map rather than a list, and
// it fails LOUDLY rather than silently: until every entry says true or false,
// `pnpm install` exits 1 with ERR_PNPM_IGNORED_BUILDS. That is the one mercy
// in this family of drifts, and it does not extend to disagreement - an entry
// dropped here while it stays in the pnpm 9 list installs perfectly and just
// stops running the build script the wallet needs.
//
// `electron` is deliberately absent: pnpm 11 no longer classifies its
// postinstall as a build script needing approval, so listing it would be
// writing config for a question pnpm never asks.
{
    const NOT_ASKED_BY_PNPM11 = ['electron'];
    const allowlist = [...(ws.onlyBuiltDependencies ?? [])].sort();
    const map = ws.allowBuilds;

    assert.ok(map && typeof map === 'object' && !Array.isArray(map),
        'pnpm-workspace.yaml declares allowBuilds, the pnpm 11 home of the install-script '
        + 'allowlist (without it, pnpm 11 refuses to install at all)');

    for (const [name, value] of Object.entries(map)) {
        assert.ok(value === 'true' || value === 'false',
            `allowBuilds."${name}" is "${value}": pnpm writes a placeholder there when it wants an `
            + 'answer, and a placeholder is an install failure, not a setting');
    }

    const allowed = Object.entries(map).filter(([, v]) => v === 'true').map(([k]) => k).sort();
    const denied = Object.entries(map).filter(([, v]) => v === 'false').map(([k]) => k);

    assert.deepEqual(allowed, allowlist.filter((n) => !NOT_ASKED_BY_PNPM11.includes(n)),
        'allowBuilds and onlyBuiltDependencies allow the SAME install scripts '
        + `(allowBuilds:true = ${JSON.stringify(allowed)}, onlyBuiltDependencies = `
        + `${JSON.stringify(allowlist)} less ${JSON.stringify(NOT_ASKED_BY_PNPM11)})`);

    for (const name of denied) {
        assert.ok(!allowlist.includes(name),
            `"${name}" is denied in allowBuilds and allowed in onlyBuiltDependencies: the two homes `
            + 'disagree about whether its install scripts may run, and which one wins is a pnpm version');
    }
}

// -------------------------------------------------- .npmrc settings home
//
// pnpm 11 stopped reading these from `.npmrc`. Both copies are kept - a
// settings home that goes unread must not read as "unset" to a human - so
// they have to agree for the same reason the overrides do.
{
    const YES = new Set(['true', 'yes', '1']);

    assert.equal(YES.has(String(ws.shamefullyHoist)), YES.has(npmrc.flat['shamefully-hoist']),
        `shamefullyHoist disagrees between its two homes (pnpm-workspace.yaml="${ws.shamefullyHoist}", `
        + `.npmrc="${npmrc.flat['shamefully-hoist']}"): the flat layout is what lets bundled code in `
        + 'transitive packages resolve its shims, and losing it breaks builds, not tests');

    assert.equal(YES.has(String(ws.strictSsl)), YES.has(npmrc.flat['strict-ssl']),
        `strictSsl disagrees between its two homes (pnpm-workspace.yaml="${ws.strictSsl}", `
        + `.npmrc="${npmrc.flat['strict-ssl']}")`);

    // Direction matters for this one: it is a security pin, so "they agree"
    // is not enough - they must agree on ON. (.)
    assert.ok(YES.has(String(ws.strictSsl)),
        'strictSsl is ON in pnpm-workspace.yaml: certificate verification for registry fetches '
        + 'must not be downgradable by a user-level config');

    const wsArch = parseNestedLists(wsText, 'supportedArchitectures');
    for (const axis of ['os', 'cpu']) {
        assert.deepEqual([...(wsArch[axis] ?? [])].sort(),
            [...(npmrc.lists[`supportedArchitectures.${axis}`] ?? [])].sort(),
            `supportedArchitectures.${axis} disagrees between its two homes `
            + `(pnpm-workspace.yaml=${JSON.stringify(wsArch[axis])}, `
            + `.npmrc=${JSON.stringify(npmrc.lists[`supportedArchitectures.${axis}`])}). `
            + 'This decides which platform binaries are fetched, so it changes what a two-arch '
            + 'build has to package and whether a reproduce run uses the same toolchain twice');
    }
}

// The version this is all calibrated against. If someone bumps pnpm, the
// homes swap and this file's premise needs re-checking, so make the bump
// land here first.
{
    assert.ok(/^pnpm@11\./.test(pkg.packageManager || ''),
        `packageManager is pinned to pnpm 11.x (found "${pkg.packageManager}"). `
        + 'On a major bump, re-verify which config home pnpm reads before trusting either: '
        + '9 read package.json, 10 moved to pnpm-workspace.yaml, 11 also stopped reading .npmrc.');
}

console.log('pnpm-config-parity smoke: ok');
