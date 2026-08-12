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

// §3 caching. Holds tools/release/verify-edge-cache.mjs
// to its verdicts WITHOUT a network, which is the only way the branch
// that matters can be tested at all: "a 404 must not score as a pass"
// can only be exercised live while nothing is published, and the moment
// the first release fixes that, the case becomes unreachable.
//
// The verdicts are the product here, not the HTTP plumbing. A probe that
// scores the wrong thing green is worse than no probe: §3 says exactly
// that about a rule tested against a name we do not use.

import { strict as assert } from 'node:assert';

import { judgeArtifact, judgePointer } from '../../../tools/release/verify-edge-cache.mjs';

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
}

console.log('OK: edge cache contract smoke (a 404 is UNPROVEN, never a pass;'
    + 'MISS and EXPIRED are as fatal as HIT; the origin and the edge are both required)');
