// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for : VOTE composes through the SDK's own builder, host-side.
//
// VOTE's wire params are produced by sdk.voting.*Params - the option/ballot
// encoding, mode enums and gate defaults all live in the SDK, which runs
// HOST-side. The three VOTE surfaces each kept a hand-written client-side
// mirror of that encoding to feed the generic compose route.
//
// A mirror that drifts here does not fail loudly: the §5.3.2 tamper check
// verifies the composed PSBT against the params the encoder was HANDED, so a
// wrong mirror yields a perfectly self-consistent PSBT for the WRONG ballot,
// and the flow's own builder never runs to catch it because `prebuiltPsbt`
// short-circuits the rebuild. The user would be shown, and would sign, an
// action nobody validated. Spec §1: the SDK owns the logic, the wallet owns
// the glass.
//
// Watcher mode legitimately keeps a mirror: it encodes through
// buildActionPsbtRequest and never signs, so there is no confirm surface and
// no signature to mis-attribute.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

// --- 1. the host route ------------------------------------------------

const hostSrc = read('packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
assert.match(hostSrc, /host\.register\('action\.vote\.composeForConfirm'/,
    'the VOTE compose route is registered');
assert.match(hostSrc, /sdk\.voting\[builder\]\(req\?\.params\)/,
    'the route runs the real sdk.voting builder on the caller-supplied input');
assert.match(hostSrc, /voteParams: params/,
    'the built wire params ride back so the confirm page decodes what was composed');

// `builder` crosses the messaging boundary from the renderer, so it must be
// allow-listed rather than used to index sdk.voting with arbitrary input.
{
    const routeIdx = hostSrc.indexOf("host.register('action.vote.composeForConfirm'");
    const route = hostSrc.slice(routeIdx, routeIdx + 3000);
    assert.match(route, /VOTE_BUILDERS\s*=\s*\[/, 'the builder name is allow-listed');
    for (const b of ['createPollParams', 'castBallotParams', 'delegateVoteParams', 'clearVoteDelegationParams']) {
        assert.ok(route.includes(`'${b}'`), `allow-list covers ${b}`);
    }
    assert.match(route, /VOTE_BUILDERS\.includes\(builder\)/, 'an unlisted builder is rejected');
}

// --- 2. all three shells expose it ------------------------------------

for (const [shell, ...p] of [
    ['extension', 'packages', 'extension', 'src', 'popup', 'messaging.js'],
    ['web', 'packages', 'web', 'src', 'messaging.js'],
    ['desktop', 'packages', 'desktop', 'renderer', 'messaging.js'],
]) {
    const src = read(...p);
    assert.match(src, /export function composeVoteForConfirm\(opts\)/,
        `${shell}: composeVoteForConfirm is exported`);
    assert.match(src, /sendMessage\('action\.vote\.composeForConfirm', opts\)/,
        `${shell}: routed to the VOTE compose route`);
}

// --- 3. every VOTE confirm surface uses it ----------------------------

const VOTE_FORMS = [
    ['CreatePollForm.jsx', 'createPollParams'],
    ['DelegateVoteForm.jsx', 'delegateVoteParams'],
    ['PollDetail.jsx', 'castBallotParams'],
];
for (const [file, builder] of VOTE_FORMS) {
    const src = read('packages', 'core', 'src', 'shared', 'routes', file);
    assert.match(src, /messaging\.composeVoteForConfirm\(\{/,
        `${file}: composes through the VOTE builder route`);
    assert.ok(src.includes(`'${builder}'`), `${file}: names the ${builder} builder`);

    // The confirm path must not hand the GENERIC compose route a VOTE
    // actionData: that is the client-side mirror this smoke exists to keep
    // out of the signing path.
    const confirmIdx = src.indexOf('actionConfirm.run({');
    if (confirmIdx !== -1) {
        const runBlock = src.slice(confirmIdx, confirmIdx + 1400);
        assert.ok(
            !/actionData: \{ action: 'VOTE'/.test(runBlock),
            `${file}: the confirm path composes via the builder, not a client-side wire mirror`,
        );
    }
}

// PollDetail specifically: the ballot the SUBMIT lane sends must be the same
// UI-level object the compose route was given, or the two could diverge.
{
    const src = read('packages', 'core', 'src', 'shared', 'routes', 'PollDetail.jsx');
    assert.match(src, /function ballotParams\(\)/,
        'PollDetail derives the ballot input in one place');
    const compose = /builder: 'castBallotParams',\s*\n\s*params: ballotParams\(\),/.test(src);
    assert.ok(compose, 'PollDetail composes from ballotParams()');
    assert.match(src, /params: ballotParams\(\),[\s\S]{0,200}prebuiltPsbt,/,
        'PollDetail submits the same ballotParams() it composed');
}

console.log(
    'OK: vote compose-for-confirm smoke (: action.vote.composeForConfirm runs the real '
    + 'sdk.voting builder host-side with an allow-listed builder name and returns voteParams; '
    + 'exported by all 3 shells; CreatePollForm + DelegateVoteForm + PollDetail all compose through '
    + 'it and none feeds a client-side wire mirror into the signing path)',
);
