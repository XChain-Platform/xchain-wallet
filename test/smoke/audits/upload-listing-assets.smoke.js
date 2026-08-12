// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for tools/release/upload-listing-assets.mjs (row 63).
//
// The uploader only does anything against live App Store Connect, so what is
// worth pinning offline is what decides whether an upload is allowed to happen
// at all, and what its success is allowed to mean.
//
// The defects these cases descend from, all measured on this listing:
//
// 1. The listing carried images from a build 18 shared-UI commits older than
//    the binary Apple held, and nothing could see it from a terminal. So the
//    uploader takes the PIN as its input, never a directory: an image the pin
//    does not name is not a candidate, and there is no flag to loosen that.
// 2. A multi-file upload landed in completion order rather than capture order
//    (2026-08-06), and Apple serves the first three images on install sheets.
//    So order is set explicitly, after the fact, from the pin's own order.
// 3. `assetDeliveryState: COMPLETE` does not imply Apple has published the
//    asset's checksum (measured 2026-08-10: eight images COMPLETE, and the
//    gate could not compare one set because a checksum was still absent).
//    A wait that stops at COMPLETE therefore reports a success the verifying
//    gate cannot confirm, so the wait includes the digest.
// 4. The digest that means something is APPLE'S, not ours. Two locally
//    computed digests agreeing proves only that the file did not change
//    mid-run.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

import {
    parseArgs, apiError, awaitComplete, ascClient, USAGE,
} from '../../../tools/release/upload-listing-assets.mjs';

// --- argument parsing -------------------------------------------------------

{
    const a = parseArgs([]);
    assert.equal(a.dryRun, false, 'uploading is the default; a dry run is asked for');
    assert.equal(a.locale, 'en-US', 'the default localization is the one the listing uses');
    assert.equal(a.allowUnpinnedBuild, false, 'the pin/build agreement is enforced unless overridden');
}

{
    const a = parseArgs(['--dry-run']);
    assert.equal(a.dryRun, true);
    assert.ok(!a.error, '--dry-run is a known flag');
}

{
    const a = parseArgs(['--locale', 'de-DE']);
    assert.equal(a.locale, 'de-DE', 'a localization can be named');
}

{
    // An unknown flag is an error rather than a silent ignore: this tool
    // mutates a store listing, and "the flag you thought you passed did
    // nothing" is the wrong way to find that out.
    const a = parseArgs(['--force']);
    assert.ok(a.error, 'an unknown argument is reported');
    assert.match(a.error, /--force/, 'and it names the argument');
}

// --- Apple's errors are rendered, not swallowed ------------------------------

{
    const line = apiError({ status: 409, body: { errors: [{ title: 'Conflict', detail: 'asset already exists' }] } });
    assert.match(line, /Conflict/, "Apple's title survives");
    assert.match(line, /asset already exists/, "and so does Apple's detail");
}

{
    const line = apiError({ status: 500, body: {} });
    assert.match(line, /500/, 'a body-less failure still names its status');
}

// --- the completion wait ----------------------------------------------------

/** An api double that replays a fixed sequence of GET responses. */
function apiReplaying(states) {
    let i = 0;
    return {
        get: async () => {
            const attributes = states[Math.min(i, states.length - 1)];
            i += 1;
            return { status: 200, body: { data: { attributes } } };
        },
    };
}

const noSleep = async () => {};

{
    const api = apiReplaying([
        { assetDeliveryState: { state: 'UPLOAD_COMPLETE' } },
        { assetDeliveryState: { state: 'COMPLETE' }, sourceFileChecksum: 'abc123' },
    ]);
    const r = await awaitComplete({ api, id: 'x', sleep: noSleep });
    assert.equal(r.state, 'COMPLETE');
    assert.equal(r.checksum, 'abc123', "Apple's digest is returned so the caller can compare it");
}

{
    // Property 3. COMPLETE with no checksum is NOT done: returning here is
    // what produced an unverifiable success on 2026-08-10.
    const api = apiReplaying([{ assetDeliveryState: { state: 'COMPLETE' } }]);
    const r = await awaitComplete({ api, id: 'x', tries: 3, sleep: noSleep });
    assert.equal(r.state, 'TIMEOUT', 'COMPLETE without a checksum is not a completed upload');
}

{
    const api = apiReplaying([
        { assetDeliveryState: { state: 'FAILED', errors: [{ description: 'wrong dimensions' }] } },
    ]);
    const r = await awaitComplete({ api, id: 'x', sleep: noSleep });
    assert.equal(r.state, 'FAILED', 'a rejected asset is a failure');
    assert.match(r.errors, /wrong dimensions/, "and Apple's reason is carried out");
}

{
    // A failure must not be outwaited into a timeout: FAILED is terminal and
    // carries the reason, TIMEOUT carries nothing.
    const api = apiReplaying([
        { assetDeliveryState: { state: 'FAILED', errors: [{ code: 'ASSET_BAD' }] } },
        { assetDeliveryState: { state: 'COMPLETE' }, sourceFileChecksum: 'later' },
    ]);
    const r = await awaitComplete({ api, id: 'x', sleep: noSleep });
    assert.equal(r.state, 'FAILED', 'FAILED is terminal and is not retried into a pass');
}

// --- the client sends what Apple requires -----------------------------------

{
    const seen = [];
    const fetchImpl = async (url, init) => {
        seen.push({ url, init });
        return { status: 200, text: async () => '{}' };
    };
    const api = ascClient({ token: 'TOK', fetchImpl });
    await api.patch('/v1/appScreenshots/1', { data: {} });
    assert.equal(seen[0].init.method, 'PATCH');
    assert.equal(seen[0].init.headers.Authorization, 'Bearer TOK', 'the bearer token is attached');
    assert.equal(seen[0].init.headers['Content-Type'], 'application/json', 'a body is declared as JSON');
}

{
    // A DELETE answers 204 with an empty body, and JSON.parse('') throws. The
    // client must survive that: the whole replace path is deletes.
    const api = ascClient({ token: 'TOK', fetchImpl: async () => ({ status: 204, text: async () => '' }) });
    const r = await api.del('/v1/appScreenshots/1');
    assert.equal(r.status, 204, 'an empty 204 body does not throw');
}

// --- the refusals are documented where an operator will read them -----------

{
    assert.match(USAGE, /--dry-run/, 'the read-only mode is discoverable');
    assert.match(USAGE, /APPLE_API_KEY/, 'the credentials are named');
}

{
    // Property 1, asserted against the source rather than a behaviour, because
    // the guarantee is structural: the uploader reads the pin, and there is no
    // directory input to point somewhere else.
    const src = readFileSync(
        new URL('../../../tools/release/upload-listing-assets.mjs', import.meta.url), 'utf8',
    );
    assert.match(src, /pinnedListingDigests/, 'the pin is the input');
    assert.ok(!/--dir\b/.test(src), 'there is no directory override that would bypass the pin');
    assert.match(
        src, /PREPARE_FOR_SUBMISSION/,
        'the version-state refusal is present',
    );
    assert.match(
        src, /relationships\/appScreenshots/,
        'order is set explicitly after upload (property 2)',
    );
}

console.log('upload-listing-assets smoke: ok');
