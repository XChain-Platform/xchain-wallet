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

// §3 caching, measured instead of assumed.
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
// DESKTOP IS NOT THE ONLY LANE WITH A POINTER, and until run 20 it
// was the only lane this tool knew about. The direct-APK lane has a
// channel pointer of its own - `android/latest.json`, read by
// `directUpdateCheck.js` - and it is the ONLY pointer in this project that
// has ever actually been published: every desktop name above still 404s.
// So the tool built to verify the pointer contract against a real name had
// never once been pointed at the only real name there is, which is the
// same shape as the `latest*` defect one level up. The Android pointer is
// derived from the app's own `UPDATE_FEED_URL` rather than written here,
// for exactly the reason the desktop names are derived: a probe aimed at a
// name no client fetches produces a green result and protects nothing.
//
// AND THE EDGE HALF CANNOT BE READ FROM `cf-cache-status` AT ALL, which is
// the same trap one layer deeper (row 35, measured 2026-08-11). The
// warning above says a 404 is indistinguishable from a pass. The sharper
// version is that a LIVE pointer behind a PROVEN-MATCHING bypass rule is
// equally indistinguishable from one behind no rule. Four probes taken in
// the same minute against this zone, whose pointer bypass rule had been
// verified by Cloudflare Trace:
//
//   android/latest.json     rule MATCHES  no-store             DYNAMIC
//   desktop/stable.yml      rule MATCHES  (404)                DYNAMIC
//   RELEASE_HASHES/*.txt    NO rule       public, max-age=300  DYNAMIC
//   android/*.apk           NO rule       ...immutable         HIT
//
// The third line is the control that settles it: a resource that ASKS to
// be cached, with no rule bypassing it, still reads DYNAMIC - because none
// of `.yml`, `.json` or `.txt` is in Cloudflare's default cacheable-
// extension set, and DYNAMIC means "not eligible for cache", not "bypassed
// by a rule". So DYNAMIC is a function of the file EXTENSION and carries
// zero information about the rule. `BYPASS` would carry it; this zone does
// not emit it on these paths.
//
// This tool scored DYNAMIC as PASS for as long as it has existed, so its
// pointer verdict rested on a property its own inputs cannot observe -
// the same class of defect as accepting a bare `max-age` below, arriving
// on the pointer side. DYNAMIC now scores UNMEASURED: the origin half is
// real and is reported, and the edge half is declared unreadable rather
// than assumed good. The honest instrument for the edge half is
// Cloudflare's Trace API (`POST /client/v4/accounts/<id>/request-tracer/
// tracer`), which returns which rules match a URL independently of any
// origin response - and which needs a token scoped for it, which the
// release purge token (K15) deliberately is not.
//
// Usage:
//   node tools/release/verify-edge-cache.mjs \
//       --base https://downloads.xchain.io/wallet [--channel stable]
//       [--artifact <name>]
//
// Exit 0 only if every probe met the contract AND every probe was real.

import { pointerNameFor } from './update-info.mjs';
import { UPDATE_FEED_URL } from '../../packages/web/src/update/directUpdateCheck.js';

const BAD_NAME = /^latest/;

/**
 * The direct-APK pointer's path, relative to the feed root, taken from the
 * URL the app itself fetches.
 *
 * Fails shut rather than guessing. If the app's feed ever moves out from
 * under `/wallet/`, the lazy read of this would silently yield an absolute
 * path and probe a URL nobody serves - which is the `latest*` failure
 * wearing different clothes, and it would report UNPROVEN (a 404) rather
 * than admitting the tool no longer knows where the pointer lives.
 *
 * @param {string} feedUrl
 * @returns {string} e.g. "android/latest.json"
 */
export function androidPointerPath(feedUrl) {
    const { pathname } = new URL(feedUrl);
    const m = /\/wallet\/(.+)$/.exec(pathname);
    if (!m) {
        throw new Error(`cannot derive the Android pointer path from "${feedUrl}": it is `
            + 'no longer under a /wallet/ feed root, so this tool does not know what to '
            + 'probe. Fix the derivation rather than hardcoding a name.');
    }
    return m[1];
}

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
cache contract? (§3.)

Usage:
  node tools/release/verify-edge-cache.mjs \\
      --base https://downloads.xchain.io/wallet [--channel stable] \\
      [--artifact <name>]

Options:
  --base <url>       feed root, default https://downloads.xchain.io/wallet
  --channel <name>   update channel, default stable
  --artifact <name>  also probe one artifact. A bare name is read as a
                     desktop name; pass a lane to probe another, e.g.
                     --artifact android/xchain-wallet-v0.336.0.apk
  -h, --help         print this and exit 0

Probes FIVE pointers: desktop's four, plus the direct-APK lane's
android/latest.json, which is the only one that resolves to a real file
today. The desktop names are NEVER latest*.yml (electron-builder names
update-info files after the CHANNEL, and desktop's channel is stable) and
the Android name comes from the app's own UPDATE_FEED_URL. Both are derived
rather than written here: a cache rule written against a name no client
fetches matches nothing and fails silently in the direction that looks like
working.

PROBES A LIVE CDN, which is why --help is answered before the probes rather
than after them: unhandled, the flag was dropped by the argument
reader above and the full scan ran anyway.

Exit codes:
  0  every probe met the contract AND every probe was real
  1  a probe FAILED the contract
  2  UNPROVEN: the names are right and nothing is published at them. This
     is NOT a pass.
  3  UNMEASURED: published, and the origin half holds, but the edge half
     cannot be read from cf-cache-status on these paths. Also NOT a pass.
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

// Every pointer this project publishes, as a path under `base`. Desktop's
// four live under `desktop/`; the direct-APK lane's lives under `android/`
// and is the only one that resolves to a real file today.
const pointerPaths = [
    ...pointers.map((name) => `desktop/${name}`),
    androidPointerPath(UPDATE_FEED_URL),
];

for (const p of pointers) {
    if (BAD_NAME.test(p)) {
        process.stderr.write(`refusing to probe "${p}": the pointers are named after the `
            + 'CHANNEL, never `latest*`. A rule written against a name we do not use '
            + 'produces a green result and protects nothing.\n');
        process.exit(1);
    }
}

/**
 * The user-agent a real client of this path sends.
 *
 * Not decoration. The zone's managed bot ruleset blocked every non-browser
 * client until the §3 skip rule, so a probe wearing the wrong agent
 * measures a path nobody takes - and on this zone that is not theoretical:
 * `wallet.xchain.io` and `mcp.xchain.io` still answer 403 to every
 * non-browser client today, while `downloads.xchain.io` answers 200.
 * Desktop's updater sends the literal `electron-builder`; the Android
 * pointer is fetched by the app's WebView, which sends a Chrome agent.
 *
 * @param {string} path
 * @returns {string}
 */
function agentFor(path) {
    return path.startsWith('android/')
        ? 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36'
        : 'electron-builder';
}

async function probe(url, userAgent = 'electron-builder') {
    try {
        const res = await fetch(url, {
            redirect: 'manual',
            headers: { 'user-agent': userAgent },
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
const POINTER_CACHED = new Set(['HIT', 'MISS', 'EXPIRED', 'REVALIDATED', 'STALE', 'UPDATING']);

// The only status that PROVES a bypass rule is in force from a header
// alone. See the DYNAMIC finding at the top of this file.
const POINTER_PROVEN = new Set(['BYPASS']);

// Not cached, and not evidence either: DYNAMIC is what a path whose
// extension is outside Cloudflare's default cacheable set returns whether
// or not any rule touches it, so it can neither pass nor fail a pointer.
const POINTER_UNREADABLE = new Set(['DYNAMIC']);

/**
 * Score one pointer response. Exported and pure so the verdicts can be
 * tested without a network: the branch that matters most (a 404 scoring
 * as UNPROVEN rather than PASS) is by definition hard to exercise against
 * a live feed, since it only appears when nothing is published.
 *
 * @param {{status?: number, cacheControl?: string, cfCache?: string, error?: string}} r
 * @returns {{verdict: 'PASS'|'FAIL'|'UNPROVEN'|'UNMEASURED'|'ERROR', detail: string}}
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
    } else if (!POINTER_PROVEN.has(cf) && !POINTER_UNREADABLE.has(cf)) {
        problems.push(`cf-cache-status=${r.cfCache}: unrecognised, not scoring it as a pass`);
    }

    if (problems.length) return { verdict: 'FAIL', detail: problems.join('; ') };

    // The origin half held and the edge is not caching, but on these paths
    // that is not the same as a bypass rule existing - and this function
    // called it a pass for as long as it has existed. Report what was
    // actually observed and name what was not.
    if (POINTER_UNREADABLE.has(cf)) {
        return {
            verdict: 'UNMEASURED',
            detail: `origin half holds (cache-control=${r.cacheControl}), but `
                + `cf-cache-status=${r.cfCache} cannot show whether a bypass rule covers this `
                + 'path: DYNAMIC is what this extension returns with or without one (a .txt '
                + 'served max-age=300 under NO rule reads DYNAMIC too). Only BYPASS proves the '
                + 'rule from a header; otherwise read the configuration with Cloudflare Trace',
        };
    }

    return {
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
    const cc = r.cacheControl || '';
    if (!/max-age|immutable/.test(cc)) {
        return {
            verdict: 'FAIL',
            detail: `binaries must cache freely; cache-control is "${r.cacheControl}"`,
        };
    }

    // Cached is not the same as cached BY RULE, and until run 22 this
    // function could not tell the difference. §3's binary half is
    // written at the origin as `public, max-age=31536000, immutable`, and
    // `immutable` is the one word in it a CDN fallback never supplies:
    // Cloudflare's default is a bare four-hour `max-age`. Measured 2026-08-10
    // by probing the origin with Cloudflare bypassed, the published APK reads
    // `max-age=14400` at the edge and NO cache-control at all at the origin,
    // because no LocationMatch covers the android lane in either direction.
    // A bare max-age scored PASS here, so the tool certified a platform
    // default as the contract for as long as the lane has been live.
    // Asserting the positive contract is deliberate: fingerprinting the
    // default value instead (14400) would be a literal a zone setting retunes.
    if (!/immutable/.test(cc)) {
        return {
            verdict: 'FAIL',
            detail: `cache-control is "${r.cacheControl}": cached, but by a platform default `
                + 'rather than by an origin rule. The contract says `immutable`, which no CDN '
                + 'fallback adds, so a name reading max-age alone has nothing written down '
                + 'about it and loses its caching the day the zone default changes',
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
    let unmeasured = 0;

    const tally = (name, { verdict, detail }) => {
        results.push([name, verdict, detail]);
        if (verdict === 'FAIL' || verdict === 'ERROR') failures++;
        else if (verdict === 'UNPROVEN') unproven++;
        else if (verdict === 'UNMEASURED') unmeasured++;
    };

    for (const path of pointerPaths) {
        tally(path, judgePointer(await probe(`${base}/${path}`, agentFor(path))));
    }
    if (artifact) {
        // A bare name stays a desktop name, which is what every existing
        // invocation passes. A name carrying a lane (`android/x.apk`) is
        // taken as given, so the direct-APK binary can be probed too - its
        // half of the contract is the opposite one, and it was equally
        // unreachable from here.
        const artifactPath = artifact.includes('/') ? artifact : `desktop/${artifact}`;
        tally(artifactPath, judgeArtifact(await probe(`${base}/${artifactPath}`, agentFor(artifactPath))));
    }

    const width = Math.max(...results.map(([n]) => n.length));
    process.stdout.write(`\nEdge cache contract - ${base} (channel ${channel})\n\n`);
    for (const [name, verdict, detail] of results) {
        process.stdout.write(`  ${name.padEnd(width)}  ${verdict.padEnd(10)}  ${detail}\n`);
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
    if (unmeasured) {
        process.stdout.write(
            `${unmeasured} probe(s) UNMEASURED: published, and the origin half of the contract\n`
            + 'holds on each, but the edge half cannot be read from cf-cache-status on these\n'
            + 'paths - DYNAMIC is what they return with or without a bypass rule. This is NOT\n'
            + 'a pass. Read the rule itself with Cloudflare Trace (POST /client/v4/accounts/\n'
            + '<id>/request-tracer/tracer), which reports which rules match a URL regardless\n'
            + 'of what the origin answers.\n');
        process.exit(3);
    }
    process.stdout.write('Edge cache contract holds on every real pointer.\n');
}
