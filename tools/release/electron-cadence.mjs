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
 * and anything absent lands in `missing` and makes the state inconclusive.
 * The precedence runs the other way round, though, and deliberately: what we
 * DID detect is true regardless of what we could not read, so a real patch,
 * major or support-window violation still reports `behind` even with gaps.
 * Silence is the only thing an incomplete document is not allowed to buy.
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
    const missing = [];

    // The support-window arithmetic and every major comparison below is
    // driven by this one value, so without it the tool has no verdict to
    // give - it merely has no findings, which is a different thing.
    if (!latest || !Number.isFinite(latestMajor)) {
        missing.push("dist-tags.latest (no newest stable version to compare against)");
    }
    // Without our own major's channel tag the `patch` check cannot fire,
    // so "we are on the newest patch of our major" would be assumed rather
    // than checked. It is legitimately absent once our major falls out of
    // upstream's window, which the `unsupported` problem reports on its
    // own - and that problem outranks this gap in the precedence below.
    if (!newestOnOurMajor) {
        missing.push(`dist-tags.${ourMajor}-x-y (nothing to compare our patch level against)`);
    }

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
        if (released == null) {
            // The quiet half of the same defect: no timestamp means no
            // clock, and no clock produced no problem at all. §9's grace
            // window simply never fired for that major, silently.
            missing.push(`time["${firstStable}"] (no release date, so §9's `
                + `${POLICY.MAJOR_GRACE_DAYS}-day clock for Electron ${major} cannot run)`);
        }
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

    // PRECEDENCE, STATED RATHER THAN INFERRED. A violation we actually
    // detected outranks evidence we could not read: a patch, a major or a
    // support-window breach is true whatever else the document was missing,
    // and downgrading it to "inconclusive" would lose a real finding to a
    // bookkeeping gap. Only when nothing was detected does a gap decide the
    // verdict, and then it decides it against silence. `about-to-be-
    // unsupported` alone stays a warning, exactly as before.
    const detected = problems.some((p) => p.kind !== 'about-to-be-unsupported');
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
        // Kept and DERIVED, so every existing --json reader keeps parsing
        // and now fails closed: an inconclusive run is not ok.
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

if (import.meta.url === `file://${process.argv[1]}`) {
    process.exit(await main(process.argv.slice(2)));
}
