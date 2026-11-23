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
// getting security fixes? (§9.)
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
//   3  inconclusive  the registry was unreachable, OR the document it
//                    returned did not carry the evidence the verdict rests
//                    on. NEVER folded into "current": a wallet's CVE clock
//                    must not read green because a network call failed or
//                    because the answer came back empty.

import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * §9's thresholds, in one place because they are the policy.
 *
 * `MAJOR_GRACE_DAYS` is §9's "within 4 weeks of upstream release".
 * `PATCH_GRACE_DAYS` is how long a new patch on our own major may sit
 * untaken. It cannot be zero: pnpm refuses any third-party entry published
 * less than a day ago (pnpm-workspace.yaml keeps that floor on, browser
 * engine included), and Electron has shipped three 44.x patches inside four
 * days, so a zero-grace rule was red on every day a patch shipped with no
 * installable pin that could clear it. A week keeps the weekly run honest:
 * a patch older than seven days is owed and fails the run.
 * `SUPPORTED_MAJORS` is upstream's own window: Electron maintains the
 * newest three stable majors and nothing older, so being outside it means
 * no security fixes exist for the engine we ship, at any version.
 */
export const POLICY = {
    MAJOR_GRACE_DAYS: 28,
    PATCH_GRACE_DAYS: 7,
    SUPPORTED_MAJORS: 3,
};

const majorOf = (v) => Number(String(v).split('.')[0]);
const STABLE = /^(\d+)\.(\d+)\.(\d+)$/;
/** Compare two stable x.y.z versions; anything else sorts as equal. */
function compareStable(a, b) {
    const x = STABLE.exec(String(a));
    const y = STABLE.exec(String(b));
    if (!x || !y) return 0;
    for (let i = 1; i <= 3; i += 1) {
        const d = Number(x[i]) - Number(y[i]);
        if (d) return d;
    }
    return 0;
}

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

/*
 * Compare the pin against what upstream currently offers.
 *
 * A MISSING FIELD IS NOT A CLEAN COMPARISON. The two `|| {}` defaults below
 * are what a caller needs to survive a document that is merely sparse, and
 * until 2026-09-05 they were also the whole verdict for one that is EMPTY:
 * `latest` undefined made `latestMajor` NaN, every comparison against NaN is
 * false, `problems` stayed empty, and `assess('43.2.0', {})` returned
 * `ok: true` - exit 0, CURRENT - against a document containing nothing at
 * all. That is the header's own rule broken by the function it governs: a
 * CVE clock must not read green because the data was bad, and a structurally
 * incomplete 200 from a mirror or a stale `--offline` capture is bad data
 * that arrives without an exception to catch.
 *
 * So the evidence each verdict rests on is REQUIRED rather than defaulted,
 * and anything absent or unparseable lands in `missing`. An invalid timestamp
 * is missing evidence, not a value that age arithmetic may silently accept.
 * The precedence runs the other way round, though, and deliberately: what we
 * DID detect is true regardless of what we could not read, so a real patch,
 * major or support-window violation still reports `behind` even with gaps.
 * Silence is the only thing an incomplete document is not allowed to buy.
 *
 * @param {string} version   the version we ship
 * @param {Object} packument registry document (dist-tags + time)
 */
const msOf = (value) => {
    if (typeof value !== 'string' || value.trim() === '') return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
};

function checkPatch(version, ourMajor, newest, time, nowMs, problems, missing) {
    if (!newest || newest === version) return;
    const newestReleased = time[newest] ?? null;
    const newestMs = msOf(newestReleased);
    let owed = null;
    if (newestMs == null) {
        owed = newest;
        if (newestReleased != null) {
            missing.push(`time["${newest}"] has unparseable release date ${JSON.stringify(newestReleased)}`);
        }
    } else if (nowMs != null) {
        if ((nowMs - newestMs) / 86400000 > POLICY.PATCH_GRACE_DAYS) owed = newest;
        else {
            const overdue = [];
            for (const candidate of Object.keys(time)) {
                if (!STABLE.test(candidate) || majorOf(candidate) !== ourMajor
                    || compareStable(candidate, version) <= 0) continue;
                const candidateMs = msOf(time[candidate]);
                if (candidateMs == null) {
                    missing.push(`time["${candidate}"] has unparseable release date ${JSON.stringify(time[candidate])}`);
                } else if ((nowMs - candidateMs) / 86400000 > POLICY.PATCH_GRACE_DAYS) {
                    overdue.push(candidate);
                }
            }
            owed = overdue.sort(compareStable).pop() ?? null;
        }
    }
    if (owed) {
        problems.push({
            kind: 'patch',
            detail: owed === newest
                ? `${version} is not the newest ${ourMajor}.x: ${newest} exists`
                : `${version} is behind ${owed}, out past the ${POLICY.PATCH_GRACE_DAYS}-day `
                    + `patch grace (newest ${ourMajor}.x: ${newest})`,
            since: time[owed] ?? null,
        });
    } else if (nowMs != null) {
        problems.push({
            kind: 'patch-pending',
            detail: `${newest} shipped ${time[newest]?.slice(0, 10)}; `
                + `take it within ${POLICY.PATCH_GRACE_DAYS} days of release`,
            since: time[newest] ?? null,
        });
    }
}

// Every major from ours up to `latest` is clocked, taken from the integer
// range rather than from `<N>-x-y` channel tags: a sparse document that drops
// a tag must surface that major as late or as missing evidence, never skip it.
// The range is bounded because any major older than the support window
// already fails as `unsupported`, so a malformed huge `latest` cannot spin.
const MAX_CLOCKED_MAJORS = 32;

function checkMajors(ourMajor, latestMajor, time, nowMs, problems, missing) {
    if (!Number.isInteger(ourMajor) || !Number.isInteger(latestMajor)) return;
    const first = Math.max(ourMajor + 1, latestMajor - MAX_CLOCKED_MAJORS + 1);
    for (let major = first; major <= latestMajor; major += 1) {
        const firstStable = `${major}.0.0`;
        const released = time[firstStable] ?? null;
        const releasedMs = msOf(released);
        if (releasedMs == null) {
            missing.push(released == null
                ? `time["${firstStable}"] (no release date, so §9's ${POLICY.MAJOR_GRACE_DAYS}-day clock for Electron ${major} cannot run)`
                : `time["${firstStable}"] has unparseable release date ${JSON.stringify(released)}`);
            continue;
        }
        if (nowMs == null) continue;
        const ageDays = Math.floor((nowMs - releasedMs) / 86400000);
        if (ageDays > POLICY.MAJOR_GRACE_DAYS) problems.push({
            kind: 'major',
            detail: `Electron ${major} shipped ${released.slice(0, 10)}, ${ageDays} days ago, `
                + `past §9's ${POLICY.MAJOR_GRACE_DAYS}-day rule`,
            since: released,
        });
    }
}

function checkSupport(ourMajor, latestMajor, problems) {
    const oldest = latestMajor - (POLICY.SUPPORTED_MAJORS - 1);
    if (ourMajor < oldest) problems.push({
        kind: 'unsupported',
        detail: `Electron ${ourMajor} is outside upstream's support window `
            + `(newest ${POLICY.SUPPORTED_MAJORS}: ${oldest}-${latestMajor}); `
            + 'no security fixes are published for it at any version',
    });
    else if (ourMajor === oldest && latestMajor > ourMajor) problems.push({
        kind: 'about-to-be-unsupported',
        detail: `Electron ${ourMajor} is the OLDEST supported major; `
            + `when ${latestMajor + 1} ships it stops receiving fixes`,
    });
    return oldest;
}

/** Compare the pinned version with registry evidence. */
export function assess(version, packument) {
    const tags = packument['dist-tags'] || {};
    const time = packument.time || {};
    const ourMajor = majorOf(version);
    const latest = tags.latest;
    const latestMajor = majorOf(latest);
    const newestOnOurMajor = tags[`${ourMajor}-x-y`] ?? null;
    const problems = [];
    const missing = [];
    if (!latest || !Number.isFinite(latestMajor)) {
        missing.push('dist-tags.latest (no newest stable version to compare against)');
    }
    if (!newestOnOurMajor) {
        missing.push(`dist-tags.${ourMajor}-x-y (nothing to compare our patch level against)`);
    }
    const clock = packument._now ?? new Date().toISOString();
    const nowMs = msOf(clock);
    if (packument._now != null && nowMs == null) {
        missing.push(`_now has unparseable timestamp ${JSON.stringify(packument._now)}`);
    }
    checkPatch(version, ourMajor, newestOnOurMajor, time, nowMs, problems, missing);
    checkMajors(ourMajor, latestMajor, time, nowMs, problems, missing);
    const oldestSupported = checkSupport(ourMajor, latestMajor, problems);
    const warnings = new Set(['about-to-be-unsupported', 'patch-pending']);
    const detected = problems.some((problem) => !warnings.has(problem.kind));
    let state = 'ok';
    if (detected) state = 'behind';
    else if (missing.length) state = 'inconclusive';
    return {
        version,
        major: ourMajor,
        newestOnOurMajor,
        latest,
        latestMajor,
        supportWindow: [oldestSupported, latestMajor],
        problems,
        state,
        missing,
        ok: state === 'ok',
    };
}

async function fetchPackument(fetchImpl = fetch) {
    const res = await fetchImpl('https://registry.npmjs.org/electron', {
        headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`registry answered ${res.status}`);
    return res.json();
}

const USAGE = `electron-cadence.mjs - is the Chromium we ship still getting security
fixes? (§9, the CVE clock for a wallet that ships a browser engine.)

Usage:
  node tools/release/electron-cadence.mjs [--json] [--offline <packument.json>]

Options:
  --json              machine-readable result instead of the table
  --offline <file>    read a saved registry packument instead of fetching
                      https://registry.npmjs.org/electron
  -h, --help          print this and exit 0

Reads the SHIPPED version out of pnpm-lock.yaml, not the caret range in
package.json: every release lane installs --frozen-lockfile, so the lockfile
is the pin and the range never applies.

Exit codes (house convention, verify-privacy-url.mjs):
  0  current       nothing to do
  1  behind        actionable: a patch, a major, or the support window
  2  config        the pin could not be read
  3  inconclusive  the registry was unreachable, or the document it returned
                   did not carry the evidence the verdict rests on (it names
                   what was missing). NEVER folded into "current": a wallet's
                   CVE clock must not read green because a network call
                   failed or because the answer came back empty.
`;

async function main(argv) {
    // Before the registry fetch. Unhandled, `--help` ran the whole live
    // network assessment and exited with a CVE verdict.
    if (argv.some((a) => a === '--help' || a === '-h')) {
        process.stdout.write(USAGE);
        return 0;
    }
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
    } else if (result.state === 'inconclusive') {
        // The table is deliberately NOT printed here. Its rows read
        // `newest stable: undefined` and `supported: NaN-NaN` off the very
        // fields that were missing, which is a comparison dressed up as a
        // reading. The stderr block below says what was absent instead.
        process.stdout.write(`shipped:       ${result.version} (lockfile)\n`);
        process.stdout.write(`declared:      ${result.declaredRange} in package.json - `
            + 'not the pin; every release lane installs --frozen-lockfile\n');
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

    // The document arrived and parsed, but did not carry what the verdict
    // rests on. Same voice and same exit code as an unreachable registry,
    // because it is the same failure: no answer, reported as one.
    if (result.state === 'inconclusive') {
        process.stderr.write('electron-cadence: INCONCLUSIVE - the registry document did not '
            + 'carry the evidence this verdict needs:\n');
        for (const item of result.missing) process.stderr.write(`    ${item}\n`);
        process.stderr.write('  The CVE clock is not green just because the registry data '
            + 'was incomplete.\n');
        return 3;
    }
    return result.ok ? 0 : 1;
}

const invokedDirectly = (() => {
    if (!process.argv[1]) return false;
    try {
        return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
    } catch {
        return false;
    }
})();

if (invokedDirectly) {
    process.exit(await main(process.argv.slice(2)));
}
