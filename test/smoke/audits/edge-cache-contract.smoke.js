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

//  §3 caching / . Holds tools/release/verify-edge-cache.mjs
// to its verdicts WITHOUT a network, which is the only way the branch
// that matters can be tested at all: "a 404 must not score as a pass"
// can only be exercised live while nothing is published, and the moment
// the first release fixes that, the case becomes unreachable.
//
// The verdicts are the product here, not the HTTP plumbing. A probe that
// scores the wrong thing green is worse than no probe: §3 says exactly
// that about a rule tested against a name we do not use.

import { strict as assert } from 'node:assert';

import { androidPointerPath, judgeArtifact, judgePointer } from '../../../tools/release/verify-edge-cache.mjs';
import { UPDATE_FEED_URL } from '../../../packages/web/src/update/directUpdateCheck.js';

// --- the trap this tool exists to avoid --------------------------------
//
// Measured against the live feed 2026-08-02: a 404 from downloads.xchain.io
// carries `cache-control: no-store` and `cf-cache-status: DYNAMIC`, which
// is byte-for-byte what a correctly-bypassed pointer returns. Scoring it
// as PASS would report a verified cache rule on a file that does not
// exist, behind a rule that may not exist either.
{
    const notFound = { status: 404, cacheControl: 'no-store', cfCache: 'DYNAMIC' };
    const v = judgePointer(notFound);
    assert.equal(v.verdict, 'UNPROVEN',
        'a 404 must never score as PASS. Its headers are identical to a passing '
        + 'pointer\'s, which is precisely why this has to be decided on status.');
    assert.match(v.detail, /prove NOTHING/);
}

// --- the good case ------------------------------------------------------

for (const cfCache of ['BYPASS', 'DYNAMIC', 'bypass']) {
    assert.equal(
        judgePointer({ status: 200, cacheControl: 'no-store', cfCache }).verdict, 'PASS',
        `cf-cache-status=${cfCache} on a published pointer with no-store is the contract`);
}

// --- the edge is caching a pointer: the defect the rule exists to stop --
//
// HIT is the obvious one. MISS and EXPIRED are the ones that get waved
// through by hand: they mean the path is CACHEABLE and merely was not
// cached this second, which is the same defect one request later.
for (const cfCache of ['HIT', 'MISS', 'EXPIRED', 'REVALIDATED', 'STALE', 'UPDATING']) {
    const v = judgePointer({ status: 200, cacheControl: 'no-store', cfCache });
    assert.equal(v.verdict, 'FAIL',
        `cf-cache-status=${cfCache} means the edge treats the pointer path as cacheable, `
        + 'so a rollback stays invisible downstream for the whole TTL');
    assert.match(v.detail, /CACHEABLE/);
}

// --- the origin half regressing on its own ------------------------------

{
    const v = judgePointer({ status: 200, cacheControl: 'max-age=3600', cfCache: 'BYPASS' });
    assert.equal(v.verdict, 'FAIL',
        'an edge bypass does not excuse the origin caching a pointer: §3 needs BOTH '
        + 'mechanisms, and any client reaching the origin directly reads this header');
    assert.match(v.detail, /expected no-store/);
}

// An unrecognised cf-cache-status is not a pass. A new Cloudflare status
// string must be read and classified deliberately, not defaulted through.
{
    const v = judgePointer({ status: 200, cacheControl: 'no-store', cfCache: 'SOMETHING-NEW' });
    assert.equal(v.verdict, 'FAIL', 'an unknown cf-cache-status must not default to PASS');
}
{
    const v = judgePointer({ status: 200, cacheControl: 'no-store', cfCache: null });
    assert.equal(v.verdict, 'FAIL',
        'a MISSING cf-cache-status means the response did not come through the edge at '
        + 'all, so it says nothing about the edge rule');
}

// --- transport failure is never silence ---------------------------------

{
    const v = judgePointer({ error: 'getaddrinfo ENOTFOUND' });
    assert.equal(v.verdict, 'ERROR', 'a failed probe is a failure, never an absence of news');
}

// --- the binary half ----------------------------------------------------
//
// Not decoration: if binaries do not cache, every desktop update pulls
// multi-hundred-megabyte files from the origin, and a green pointer check
// with an uncached binary path is half a working feed.
{
    assert.equal(
        judgeArtifact({ status: 200, cacheControl: 'public, max-age=31536000, immutable' }).verdict,
        'PASS', 'versioned binaries are never rewritten, so they cache freely');

    const v = judgeArtifact({ status: 200, cacheControl: 'no-store' });
    assert.equal(v.verdict, 'FAIL', 'a binary served no-store makes the origin serve every byte');
    assert.match(v.detail, /must cache freely/);

    assert.equal(judgeArtifact({ status: 404, cacheControl: 'no-store' }).verdict, 'UNPROVEN',
        'an unpublished artifact proves nothing either way');

    //  run 22. Cached and cached-BY-RULE are different states, and this
    // judge scored them identically until the origin was probed with
    // Cloudflare bypassed and answered with no cache-control at all. A bare
    // max-age is what the CDN falls back to when nothing covers the name, so
    // accepting it certified a platform default as the contract.
    const def = judgeArtifact({ status: 200, cacheControl: 'max-age=14400' });
    assert.equal(def.verdict, 'FAIL',
        'a bare max-age is a CDN default, not an origin rule: it says nothing is written '
        + 'down about this name, and it disappears the day the zone default changes');
    assert.match(def.detail, /platform default/);
    // The two FAIL branches must stay distinguishable, or the message that
    // reaches an operator cannot tell "not cached" from "cached by accident".
    assert.doesNotMatch(def.detail, /must cache freely/,
        'the by-default failure must not borrow the never-cached failure\'s message');

    assert.equal(judgeArtifact({ status: 200, cacheControl: 'public, max-age=600, immutable' }).verdict,
        'PASS', 'immutable is the load-bearing word; a rule that sets it is a rule');
}

// --- the Android pointer is IN the probe set ( run 20) ------------
//
// The lane this tool was written for has never published a pointer; the
// direct-APK lane has, and until run 20 this tool did not know it existed.
// So the check that matters here is not a verdict at all - every verdict
// above already worked - it is that the Android path is DERIVED from the
// URL the app actually fetches, so a probe can never be aimed at a name no
// client takes. That is the `latest*.yml` defect restated, and it is the
// one thing a green run of this tool could otherwise hide.
{
    assert.equal(androidPointerPath(UPDATE_FEED_URL), 'android/latest.json',
        'the direct-APK pointer path must come from the app\'s own UPDATE_FEED_URL');

    assert.equal(androidPointerPath('https://downloads.xchain.io/wallet/android/beta.json'),
        'android/beta.json',
        'the derivation must follow the app, not a name written in this tool');

    // Fails SHUT. A feed that moves out from under /wallet/ must stop the
    // tool rather than yield an absolute path: that would probe a URL
    // nobody serves and report UNPROVEN, which reads as "not published
    // yet" rather than "this tool no longer knows where to look".
    assert.throws(() => androidPointerPath('https://downloads.xchain.io/mobile/latest.json'),
        /does not know what to probe/,
        'an underivable feed path must throw, never guess');
}

// The real headers this tool measured live, kept as a case so the state that
// prompted the work cannot silently become unrepresentable. Run 20 read these
// at the edge and concluded "the binary half of the contract is right and the
// pointer half is not". Run 22 probed the ORIGIN with Cloudflare bypassed and
// disproved the first half of that sentence: BOTH Android paths answer 200
// with no cache-control at all, so neither half is a rule. The pointer is
// merely uncached by default and the APK is merely cached by default, and
// `sudo grep -rn android /etc/apache2/` on the origin returns nothing.
{
    const v = judgePointer({ status: 200, cacheControl: null, cfCache: 'DYNAMIC' });
    assert.equal(v.verdict, 'FAIL',
        'a pointer with NO cache-control is not protected by the origin at all; it is '
        + 'merely un-cached by default today, which is not a rule and does not survive '
        + 'anyone adding one');
    assert.match(v.detail, /expected no-store/);

    assert.equal(judgeArtifact({ status: 200, cacheControl: 'max-age=14400' }).verdict, 'FAIL',
        'the APK beside that pointer is cached by Cloudflare default, not by the contract; '
        + 'the origin sets no header on it at all');
}

console.log('OK: edge cache contract smoke ( §3 / : a 404 is UNPROVEN, never a pass; '
    + 'MISS and EXPIRED are as fatal as HIT; the origin and the edge are both required; '
    + ' run 20: the Android pointer is derived from the app\'s own feed URL)');
