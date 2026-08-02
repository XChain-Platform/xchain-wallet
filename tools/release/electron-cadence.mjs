// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// tools/release/electron-cadence.mjs - is the Chromium we ship still
// getting security fixes? ( §9.)
//
// WHY THIS EXISTS. §9 owns the CVE clock for a wallet that ships a
// browser engine, and it owned it in prose: "Electron pinned to major 41
// (current); upgrade to each new stable major within 4 weeks of upstream
// release. Owner: the release maintainer." Nothing read that. On
// 2026-08-02 the numbers said:
//
//   shipped        41.3.0, released 2026-04-22
//   newest on 41   41.10.3, released 2026-07-21   (seven trains of
//                                                  Chromium fixes unapplied)
//   newest stable  43.2.0                          (42 and 43 both shipped
//                                                   while the pin sat)
//
// so §9's own four-week rule had been missed twice, and the line calling
// major 41 "current" had quietly stopped being true. A prose cadence with
// no mechanism is a cadence nobody is keeping.
//
// THE PIN THAT LOOKS LIKE IT UPDATES AND DOES NOT. `packages/desktop/
// package.json` asks for `^41.3.0`, which reads as "we take patches". Every
// release lane installs with `--frozen-lockfile` (§8, and rightly: whatever
// the runner resolves is what gets signed). So the caret never applies and
// the LOCKFILE is the pin. This tool therefore reads the resolved version
// out of `pnpm-lock.yaml`, which is what actually ships, and reports the
// range only to show the gap between the two.
//
// EXIT CODES follow the house convention (verify-privacy-url.mjs):
//   0  current    nothing to do
//   1  behind     actionable: a patch, a major, or the support window
//   2  config     the pin could not be read
//   3  inconclusive  registry unreachable. NEVER folded into "current":
//                    a wallet's CVE clock must not read green because a
//                    network call failed.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * §9's thresholds, in one place because they are the policy.
 *
 * `MAJOR_GRACE_DAYS` is §9's "within 4 weeks of upstream release".
 * `SUPPORTED_MAJORS` is upstream's own window: Electron maintains the
 * newest three stable majors and nothing older, so being outside it means
 * no security fixes exist for the engine we ship, at any version.
 */
export const POLICY = {
    MAJOR_GRACE_DAYS: 28,
    SUPPORTED_MAJORS: 3,
};

const majorOf = (v) => Number(String(v).split('.')[0]);

/** The version that actually ships: the lockfile's resolution. */
export function readPinnedVersion({
    lockfile = join(root, 'pnpm-lock.yaml'),
    manifest = join(root, 'packages/desktop/package.json'),
    read = readFileSync,
} = {}) {
    const range = JSON.parse(read(manifest, 'utf8')).devDependencies?.electron
        ?? JSON.parse(read(manifest, 'utf8')).dependencies?.electron
        ?? null;

    // Deliberately a narrow parse rather than a YAML dependency: the only
    // shape we accept is pnpm's `electron:` entry with its own `version:`,
    // and anything else is a config error rather than a guess.
    const lock = read(lockfile, 'utf8');
    const match = /\n {6}electron:\n {8}specifier: [^\n]*\n {8}version: ([^\n]+)/.exec(lock);
    if (!match) return { version: null, range, reason: 'no electron resolution in pnpm-lock.yaml' };
    return { version: match[1].trim(), range };
}

/**
 * Compare the pin against what upstream currently offers.
 *
 * @param {string} version   the version we ship
 * @param {Object} packument registry document (dist-tags + time)
 */
export function assess(version, packument) {
    const tags = packument['dist-tags'] || {};
    const time = packument.time || {};
    const ourMajor = majorOf(version);
    const latest = tags.latest;
    const latestMajor = majorOf(latest);
    const newestOnOurMajor = tags[`${ourMajor}-x-y`] ?? null;

    const problems = [];

    if (newestOnOurMajor && newestOnOurMajor !== version) {
        problems.push({
            kind: 'patch',
            detail: `${version} is not the newest ${ourMajor}.x: ${newestOnOurMajor} exists`,
            // Within a major, Electron releases are almost entirely
            // Chromium security backports. Being behind here is the
            // straightforward "we ship known-fixed bugs" case.
            since: time[newestOnOurMajor] ?? null,
        });
    }

    // Every stable major newer than ours, oldest first, with how long it
    // has been out. §9's clock starts at each major's release.
    const newerMajors = Object.keys(tags)
        .map((t) => /^(\d+)-x-y$/.exec(t))
        .filter(Boolean)
        .map((m) => Number(m[1]))
        .filter((m) => m > ourMajor && m <= latestMajor)
        .sort((a, b) => a - b);

    for (const major of newerMajors) {
        const firstStable = `${major}.0.0`;
        const released = time[firstStable] ?? null;
        const ageDays = released
            ? Math.floor((Date.parse(packument._now ?? new Date().toISOString())
                - Date.parse(released)) / 86400000)
            : null;
        if (ageDays != null && ageDays > POLICY.MAJOR_GRACE_DAYS) {
            problems.push({
                kind: 'major',
                detail: `Electron ${major} shipped ${released?.slice(0, 10)}, `
                    + `${ageDays} days ago, past §9's ${POLICY.MAJOR_GRACE_DAYS}-day rule`,
                since: released,
            });
        }
    }

    const oldestSupported = latestMajor - (POLICY.SUPPORTED_MAJORS - 1);
    if (ourMajor < oldestSupported) {
        problems.push({
            kind: 'unsupported',
            detail: `Electron ${ourMajor} is outside upstream's support window `
                + `(newest ${POLICY.SUPPORTED_MAJORS}: ${oldestSupported}-${latestMajor}); `
                + 'no security fixes are published for it at any version',
        });
    } else if (ourMajor === oldestSupported && latestMajor > ourMajor) {
        // Not a failure, but the one worth seeing coming: the next major
        // upstream ships drops us out of support entirely.
        problems.push({
            kind: 'about-to-be-unsupported',
            detail: `Electron ${ourMajor} is the OLDEST supported major; `
                + `when ${latestMajor + 1} ships it stops receiving fixes`,
        });
    }

    return {
        version,
        major: ourMajor,
        newestOnOurMajor,
        latest,
        latestMajor,
        supportWindow: [oldestSupported, latestMajor],
        problems,
        // `about-to-be-unsupported` alone is a warning, not a failure.
        ok: problems.every((p) => p.kind === 'about-to-be-unsupported'),
    };
}

async function fetchPackument(fetchImpl = fetch) {
    const res = await fetchImpl('https://registry.npmjs.org/electron', {
        headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`registry answered ${res.status}`);
    return res.json();
}

async function main(argv) {
    const at = (n) => (argv.indexOf(n) === -1 ? undefined : argv[argv.indexOf(n) + 1]);
    const asJson = argv.includes('--json');

    const pin = readPinnedVersion();
    if (!pin.version) {
        process.stderr.write(`electron-cadence: ${pin.reason}\n`);
        return 2;
    }

    let packument;
    const offline = at('--offline');
    try {
        packument = offline
            ? JSON.parse(readFileSync(offline, 'utf8'))
            : await fetchPackument();
    } catch (error) {
        process.stderr.write(`electron-cadence: INCONCLUSIVE - ${error.message}\n`
            + '  The CVE clock is not green just because the registry was unreachable.\n');
        return 3;
    }

    const result = assess(pin.version, packument);
    result.declaredRange = pin.range;

    if (asJson) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
        process.stdout.write(`shipped:       ${result.version} (lockfile)\n`);
        process.stdout.write(`declared:      ${result.declaredRange} in package.json - `
            + 'not the pin; every release lane installs --frozen-lockfile\n');
        process.stdout.write(`newest ${result.major}.x:    ${result.newestOnOurMajor}\n`);
        process.stdout.write(`newest stable: ${result.latest}\n`);
        process.stdout.write(`supported:     ${result.supportWindow[0]}-${result.supportWindow[1]}\n`);
        for (const p of result.problems) {
            process.stdout.write(`  [${p.kind}] ${p.detail}\n`);
        }
        if (result.ok && !result.problems.length) process.stdout.write('CURRENT\n');
    }
    return result.ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    process.exit(await main(process.argv.slice(2)));
}
