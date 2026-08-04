#!/usr/bin/env node
/*********************************************************************
 *
 * Copyright © 2025-2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC - https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available -
 * contact legal@dankest.llc.
 *
 *********************************************************************/

//  §3 caching, measured instead of assumed. .
//
// THE RULE THIS CHECKS. Channel-pointer yml files are served no-cache;
// binaries cache freely, being versioned and never rewritten. That takes
// TWO mechanisms, not one: the origin sends `no-store` on the pointer
// paths, and Cloudflare needs a cache-bypass rule on the same paths.
// An aggressively caching edge in front of a correct origin still serves
// a rollback nobody downstream ever sees, which is the exact window a
// rollback exists to close.
//
// WHY THIS FILE EXISTS AT ALL. §3 says, in as many words: "Verify that
// rule against a REAL pointer name before trusting it: a rule tested
// against a name we do not use is worse than an untested one, because it
// produces a green result." That warning has a sharper edge than it
// looks, and it caught the first attempt to check this by hand on
// 2026-08-02:
//
//   A 404 FROM THIS FEED RETURNS `cf-cache-status: DYNAMIC` AND
//   `cache-control: no-store`.
//
// Which is byte-for-byte what a correctly-bypassed pointer returns. So
// probing `stable.yml` before any release exists produces a perfect green
// reading of a rule that may not exist, on a file that certainly does
// not. This tool refuses to score a non-200 as a pass, and says so.
//
// The pointer names are NEVER `latest*.yml`. electron-builder names
// update-info files after the CHANNEL, and desktop's channel is `stable`
// (§3, corrected in six live positions after three committed defects).
// A cache rule written against `latest*` matches nothing and fails
// silently in the direction that looks like working. This tool takes the
// names from update-info.mjs's own rule so it cannot drift from what the
// build emits.
//
// Usage:
//   node tools/release/verify-edge-cache.mjs \
//       --base https://downloads.xchain.io/wallet [--channel stable]
//       [--artifact <name>]
//
// Exit 0 only if every probe met the contract AND every probe was real.

import { pointerNameFor } from './update-info.mjs';

const BAD_NAME = /^latest/;

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? fallback : process.argv[i + 1];
}

// Importing this module for its judges must not fire a live scan, so main-ness
// is decided here rather than at the bottom: the help answer below has to come
// before the argument reads, and both have to stay out of an importer's way.
const isMain = Boolean(process.argv[1])
    && process.argv[1].endsWith('verify-edge-cache.mjs');

const USAGE = `verify-edge-cache.mjs - does the CDN edge serve the update feed under the
cache contract? ( §3.)

Usage:
  node tools/release/verify-edge-cache.mjs \\
      --base https://downloads.xchain.io/wallet [--channel stable] \\
      [--artifact <name>]

Options:
  --base <url>       feed root, default https://downloads.xchain.io/wallet
  --channel <name>   update channel, default stable
  --artifact <name>  also probe one artifact under <base>/desktop/
  -h, --help         print this and exit 0

The pointer names are NEVER latest*.yml: electron-builder names update-info
files after the CHANNEL, and desktop's channel is stable. A cache rule
written against latest* matches nothing and fails silently in the direction
that looks like working, so this takes the names from update-info.mjs's own
rule and cannot drift from what the build emits.

PROBES A LIVE CDN, which is why --help is answered before the probes rather
than after them : unhandled, the flag was dropped by the argument
reader above and the full scan ran anyway.

Exit codes:
  0  every probe met the contract AND every probe was real
  1  a probe FAILED the contract
  2  UNPROVEN: the names are right and nothing is published at them. This
     is NOT a pass.
`;

if (isMain && process.argv.slice(2).some((a) => a === '--help' || a === '-h')) {
    process.stdout.write(USAGE);
    process.exit(0);
}

const base = (arg('base') || 'https://downloads.xchain.io/wallet').replace(/\/+$/, '');
const channel = arg('channel', 'stable');
const artifact = arg('artifact');

// The shipped §2 matrix is FOUR pointers, not three: Windows and macOS
// each carry both arches in one file, Linux splits per arch. Derived from
// update-info.mjs's own rule rather than a list written here, so this
// cannot drift from what the build emits - which is the entire class of
// bug that made `latest*.yml` survive in twelve live positions.
const LANES = [
    { os: 'win32' },
    { os: 'darwin' },
    { os: 'linux', arch: 'x64' },
    { os: 'linux', arch: 'arm64' },
];
const pointers = LANES.map((lane) => pointerNameFor({ channel, ...lane }));

for (const p of pointers) {
    if (BAD_NAME.test(p)) {
        process.stderr.write(`refusing to probe "${p}": the pointers are named after the `
            + 'CHANNEL, never `latest*`. A rule written against a name we do not use '
            + 'produces a green result and protects nothing.\n');
        process.exit(1);
    }
}

async function probe(url) {
    try {
        const res = await fetch(url, {
            redirect: 'manual',
            // Every real client of this feed is a non-browser: electron-updater
            // sends the literal `electron-builder`. The zone's managed bot
            // ruleset blocked all of them until the §3 skip rule, so probing
            // as a browser would measure a path no client takes.
            headers: { 'user-agent': 'electron-builder' },
        });
        return {
            status: res.status,
            cacheControl: res.headers.get('cache-control'),
            cfCache: res.headers.get('cf-cache-status'),
            age: res.headers.get('age'),
        };
    } catch (err) {
        return { error: err.message };
    }
}

// A pointer must not be cached at the edge. HIT is a hard fail; MISS and
// EXPIRED mean the path is CACHEABLE and merely was not cached this
// second, which is the same defect one request later.
const POINTER_OK = new Set(['BYPASS', 'DYNAMIC']);
const POINTER_CACHED = new Set(['HIT', 'MISS', 'EXPIRED', 'REVALIDATED', 'STALE', 'UPDATING']);

/**
 * Score one pointer response. Exported and pure so the verdicts can be
 * tested without a network: the branch that matters most (a 404 scoring
 * as UNPROVEN rather than PASS) is by definition hard to exercise against
 * a live feed, since it only appears when nothing is published.
 *
 * @param {{status?: number, cacheControl?: string, cfCache?: string, error?: string}} r
 * @returns {{verdict: 'PASS'|'FAIL'|'UNPROVEN'|'ERROR', detail: string}}
 */
export function judgePointer(r) {
    if (r.error) return { verdict: 'ERROR', detail: r.error };

    // The trap, stated as code. A 404 from this feed carries `no-store`
    // and `DYNAMIC` and is indistinguishable from a correct pass.
    if (r.status !== 200) {
        return {
            verdict: 'UNPROVEN',
            detail: `HTTP ${r.status} - nothing is published at this name yet, so its `
                + `headers (cache-control=${r.cacheControl}, cf-cache-status=${r.cfCache}) `
                + 'prove NOTHING about the rule. A 404 from this feed looks exactly like a pass.',
        };
    }

    const problems = [];
    if (!/no-store|no-cache/.test(r.cacheControl || '')) {
        problems.push(`origin cache-control is "${r.cacheControl}", expected no-store`);
    }
    const cf = (r.cfCache || '').toUpperCase();
    if (POINTER_CACHED.has(cf)) {
        problems.push(`cf-cache-status=${r.cfCache}: the edge treats this path as `
            + 'CACHEABLE. A rollback would be invisible downstream for the whole TTL');
    } else if (!POINTER_OK.has(cf)) {
        problems.push(`cf-cache-status=${r.cfCache}: unrecognised, not scoring it as a pass`);
    }

    return problems.length
        ? { verdict: 'FAIL', detail: problems.join('; ') }
        : {
            verdict: 'PASS',
            detail: `cache-control=${r.cacheControl} cf-cache-status=${r.cfCache}`,
        };
}

/**
 * Score the binary half of the contract. Not decoration: if binaries do
 * NOT cache, every desktop update pulls multi-hundred-megabyte files from
 * the origin, and a green pointer check with an uncached binary path is
 * half a working feed.
 *
 * @param {{status?: number, cacheControl?: string, error?: string}} r
 * @returns {{verdict: 'PASS'|'FAIL'|'UNPROVEN'|'ERROR', detail: string}}
 */
export function judgeArtifact(r) {
    if (r.error) return { verdict: 'ERROR', detail: r.error };
    if (r.status !== 200) {
        return { verdict: 'UNPROVEN', detail: `HTTP ${r.status} - not published` };
    }
    if (!/max-age|immutable/.test(r.cacheControl || '')) {
        return {
            verdict: 'FAIL',
            detail: `binaries must cache freely; cache-control is "${r.cacheControl}"`,
        };
    }
    return { verdict: 'PASS', detail: `cache-control=${r.cacheControl}` };
}

// Importing this module for its judges must not fire a live scan against
// the production feed. Everything above is pure; everything below probes.
// `isMain` is computed near the top, where the --help answer needs it.
if (!isMain) {
    // eslint-disable-next-line no-restricted-syntax
    // (a bare `export` module: the caller wants judgePointer/judgeArtifact)
} else {
    const results = [];
    let failures = 0;
    let unproven = 0;

    const tally = (name, { verdict, detail }) => {
        results.push([name, verdict, detail]);
        if (verdict === 'FAIL' || verdict === 'ERROR') failures++;
        else if (verdict === 'UNPROVEN') unproven++;
    };

    for (const name of pointers) {
        tally(name, judgePointer(await probe(`${base}/desktop/${name}`)));
    }
    if (artifact) {
        tally(artifact, judgeArtifact(await probe(`${base}/desktop/${artifact}`)));
    }

    const width = Math.max(...results.map(([n]) => n.length));
    process.stdout.write(`\nEdge cache contract - ${base} (channel ${channel})\n\n`);
    for (const [name, verdict, detail] of results) {
        process.stdout.write(`  ${name.padEnd(width)}  ${verdict.padEnd(8)}  ${detail}\n`);
    }
    process.stdout.write('\n');

    if (failures) {
        process.stdout.write(`${failures} probe(s) FAILED the contract.\n`);
        process.exit(1);
    }
    if (unproven) {
        process.stdout.write(
            `${unproven} probe(s) UNPROVEN: the names are right and nothing is published at\n`
            + 'them, so the edge rule is still unverified. This is NOT a pass. Re-run after\n'
            + 'the first release publishes real pointers - that is the only moment the rule\n'
            + 'can be checked against a real name, which is what §3 asks for.\n');
        process.exit(2);
    }
    process.stdout.write('Edge cache contract holds on every real pointer.\n');
}
