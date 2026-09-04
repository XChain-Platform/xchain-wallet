// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A security override that is SET is not a security override that WORKS.
//
// pnpm-config-parity.smoke.js already proves the override set is identical in
// its three homes. That check is blind to the two ways a pin still leaves the
// advisory open:
//
//   1. The pin names a version BELOW the patched one. `brace-expansion@5:
//      ^5.0.6` reads like a security pin and resolved 5.0.6, which is
//      vulnerable to both CVE-2026-13149 (patched in 5.0.7) and CVE-2026-69152
//      (patched in 5.0.9). Nothing in the repo disagreed with it, because
//      nothing in the repo knew what the patched version was. Found 2026-09-02,
//      when a fifth Dependabot alert opened against pins that four earlier
//      alerts had been declared closed by.
//
//   2. The pin is raised and the lockfile is not regenerated. `pnpm install`
//      resolves overrides at install time, so package.json and the workspace
//      file can agree on a floor that no installed tree has ever seen. What
//      ships is the lockfile.
//
// So this file records, separately from the pins, the version each advisory
// was actually patched in, and asserts BOTH the pin and the resolved version
// clear it. The asymmetry is deliberate: raising a pin above its floor needs
// no edit here, lowering one below its floor fails.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

/**
 * The version each advisory was patched in, keyed by the override that closes
 * it. Keys match the override keys verbatim, `name@major` scoping included,
 * because that is the granularity a floor applies at: brace-expansion patched
 * the same CVE separately on three lines.
 *
 * Entries are added when a pin is added, never derived from the pin. A floor
 * copied out of the pin it is meant to check would agree with anything.
 */
const ADVISORY_FLOORS = {
    // GHSA-3jxr-9vmj-r5cp / CVE-2026-13149 (exponential-time {} expansion)
    // patched 1.1.16 / 2.1.2 / 5.0.7; GHSA-rgw5-rvv9-x895 / CVE-2026-69152
    // (unbounded intermediate arrays, an UNCATCHABLE OOM) supersedes it on
    // every line at 1.1.18 / 2.1.4 / 5.0.9.
    'brace-expansion@1': { floor: '1.1.18', advisories: ['GHSA-rgw5-rvv9-x895'] },
    'brace-expansion@2': { floor: '2.1.4', advisories: ['GHSA-rgw5-rvv9-x895', 'GHSA-3jxr-9vmj-r5cp'] },
    'brace-expansion@5': { floor: '5.0.9', advisories: ['GHSA-rgw5-rvv9-x895', 'GHSA-3jxr-9vmj-r5cp'] },
    // CVE-2026-71848 (languageDetector quadratic blowup), -71849 (proxy helper
    // forwards Connection-scoped response headers), -71850 (memo() retains SSR
    // output across requests). All three patched in one release.
    hono: { floor: '4.12.34', advisories: ['GHSA-54fx-42gc-7vw4', 'GHSA-79qm-7rj5-m7r9', 'GHSA-f23p-vx2j-j53r'] },
    // GHSA-7p8r-x3mc-p8w7 plus the four published 2026-09-02: host confusion
    // between fast-uri and the WHATWG parser, and SSRF through skipped IDN
    // canonicalization.
    'fast-uri': { floor: '3.1.6', advisories: ['GHSA-7p8r-x3mc-p8w7', 'GHSA-5jgf-p345-68v8'] },
    // GHSA-52cp-r559-cp3m: quadratic CPU on merge-key chains, reachable from
    // the channel pointer electron-updater downloads from the release feed.
    'js-yaml@4': { floor: '4.3.1', advisories: ['GHSA-52cp-r559-cp3m'] },
};

/** `1.2.10` sorts above `1.2.9`; these are all plain three-part releases. */
function compare(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    }
    return 0;
}

/**
 * Split an override key into the package it names and the major it scopes to.
 * `brace-expansion@2` -> ['brace-expansion', '2']; `hono` -> ['hono', null];
 * `@tootallnate/once` -> ['@tootallnate/once', null], since the leading `@` of
 * a scope is not a major separator.
 */
function splitKey(key) {
    const at = key.lastIndexOf('@');
    if (at > 0 && /^\d+$/.test(key.slice(at + 1))) return [key.slice(0, at), key.slice(at + 1)];
    return [key, null];
}

/** The lowest version a `^x.y.z` / `>=x.y.z` / `x.y.z` spec admits. */
function lowestAdmitted(spec) {
    const m = /(\d+\.\d+\.\d+)/.exec(String(spec));
    assert.ok(m, `override spec "${spec}" names no concrete version, so it pins nothing`);
    return m[1];
}

/**
 * Every version of every package the lockfile's `packages:` section resolved,
 * as name -> [version]. Read as text rather than through a YAML parser for the
 * same reason pnpm-config-parity.smoke.js does: this guards the install, so it
 * must not need an install to be trustworthy.
 *
 * Keys look like `'@scope/name@1.2.3':` or `name@1.2.3(peer@4.5.6):`; the peer
 * suffix is dropped, and the version is the part after the LAST `@` so scoped
 * names survive.
 */
function resolvedVersions(lockText) {
    const out = {};
    let inPackages = false;
    for (const raw of lockText.split('\n')) {
        if (/^[A-Za-z]/.test(raw)) { inPackages = /^packages:\s*$/.test(raw); continue; }
        if (!inPackages) continue;
        const entry = /^ {2}'?((?:@[^/]+\/)?[^'\s]+?)@(\d+\.\d+\.\d+[^('\s:]*)'?(?:\([^)]*\))*'?:\s*$/.exec(raw);
        if (!entry) continue;
        (out[entry[1]] ||= []).push(entry[2]);
    }
    return out;
}

const pkg = JSON.parse(read('package.json'));
const lockText = read('pnpm-lock.yaml');
const overrides = pkg.pnpm?.overrides ?? {};
const installed = resolvedVersions(lockText);

assert.ok(Object.keys(installed).length > 100,
    'the lockfile\'s packages: section parsed into a real dependency list '
    + `(got ${Object.keys(installed).length} names; a near-empty result means the lockfile format moved`
    + ' and every assertion below would pass vacuously)');

// --------------------------------------------- every recorded floor is pinned

for (const [key, { floor, advisories }] of Object.entries(ADVISORY_FLOORS)) {
    const spec = overrides[key];
    assert.ok(spec,
        `override "${key}" is gone from package.json, but ${advisories.join(', ')} still needs a floor at `
        + `${floor}. Removing a security pin is a decision; make it here too, with the reason.`);

    const pinned = lowestAdmitted(spec);
    assert.ok(compare(pinned, floor) >= 0,
        `override "${key}" is "${spec}", whose lowest admitted version ${pinned} is BELOW the `
        + `${floor} that patched ${advisories.join(', ')}. The pin is set and the advisory is open.`);
}

// ------------------------------------ the lockfile resolved at or above them

for (const [key, { floor, advisories }] of Object.entries(ADVISORY_FLOORS)) {
    const [name, major] = splitKey(key);
    const found = installed[name] ?? [];

    assert.ok(found.length,
        `"${name}" is pinned by override "${key}" but appears nowhere in the lockfile. Either the pin `
        + 'is dead weight, or the lockfile predates it and no install has ever resolved it.');

    const inScope = major === null ? found : found.filter((v) => v.split('.')[0] === major);

    // A major-scoped pin that matches nothing is not a pass: the whole point of
    // scoping by major is that this line is resident in the tree.
    assert.ok(inScope.length,
        `override "${key}" scopes to the ${major}.x line of "${name}", and the lockfile holds `
        + `none: ${JSON.stringify(found)}. Retire the pin or fix its scope.`);

    for (const version of inScope) {
        assert.ok(compare(version, floor) >= 0,
            `pnpm-lock.yaml resolved "${name}" at ${version}, below the ${floor} that patched `
            + `${advisories.join(', ')}. This is what installs, whatever package.json says: `
            + 'run pnpm install to regenerate the lockfile against the raised pin.');
    }
}

// ------------------------- and no pin at all resolved below its own floor
//
// Wider than the advisory table and cheaper to keep true: whatever the reason
// a package is pinned, an installed tree that sits below the pin means the
// lockfile is stale.

for (const [key, spec] of Object.entries(overrides)) {
    const pinned = lowestAdmitted(spec);
    const [name, major] = splitKey(key);

    for (const version of installed[name] ?? []) {
        if (major !== null && version.split('.')[0] !== major) continue;
        assert.ok(compare(version, pinned) >= 0,
            `override "${key}" is "${spec}" but the lockfile resolved ${name}@${version}, below it. `
            + 'The pin was raised without regenerating pnpm-lock.yaml, so nothing that installs from '
            + 'this repo gets the version the pin names.');
    }
}

console.log(`security-override-floors smoke: ok (${Object.keys(ADVISORY_FLOORS).length} advisory floors, `
    + `${Object.keys(overrides).length} pins checked against the lockfile)`);
