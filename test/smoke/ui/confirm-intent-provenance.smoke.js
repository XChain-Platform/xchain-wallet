// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for : the sentence a user reads before signing comes from the
// SDK's describer, applied to what was actually COMPOSED.
//
// Two halves, and each was a real defect:
//
//   1. PROVENANCE. §1.1 requires the confirm surface to render "from
//      decoder.parse() of an action string, never from form state or a
//      caller's claimed intent". Every migrated form used to build its own
//      `decoded` from ITS OWN form params and pass it down, so a surface that
//      hand-builds wire params (the  VOTE mirror hazard) would describe
//      the form's version of events while signing the encoder's. The host now
//      describes the composed action string and carries it in the envelope.
//
//   2. WHICH DESCRIBER. The wallet kept a local copy of the describer the SDK
//      owns (§3.2). It had drifted: 13 actions to the SDK's 30, so a dApp
//      asking to sign an ORDER, a STAKE or a VOTE got "no plain-English
//      summary is available" on the approval screen - and it applies none of
//      §3.5's display hardening, on the one signing surface whose params an
//      ATTACKER writes.
//
// The local describer legitimately survives as the in-form DRAFT preview
// (synchronous, form state by definition, nothing signs from it). What this
// smoke forbids is a SIGNING surface reading it.

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const shared = join(wsRoot, 'packages', 'core', 'src', 'shared');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

// --- 1. the host describes the COMPOSED action, via the SDK ----------

const composeSrc = read('packages', 'core', 'src', 'flows', 'composeActionForConfirm.js');
assert.match(composeSrc, /sdk\.decoder\.describe\(parsed,/,
    'composeActionForConfirm describes via sdk.decoder.describe');
assert.match(composeSrc, /ownAddresses: \[\.\.\.own\]/,
    '§3.2 extended ctx: own addresses reach the describer so a self-send is marked');
assert.ok(!/from '\.\.\/decoder\/actionDecoder\.js'/.test(composeSrc),
    'the host no longer imports the wallet-local describer');
// The describer must read what parse() returned, not the caller's actionData:
// that ordering IS the guarantee.
const describeIdx = composeSrc.indexOf('sdk.decoder.describe(');
const parseIdx = composeSrc.indexOf('sdk.decoder.parse(');
assert.ok(parseIdx > -1 && describeIdx > parseIdx,
    'describe consumes the parse of the composed action string');

// --- 2. no confirm call site re-describes from form state ------------

const routesDir = join(shared, 'routes');
const files = [
    ...readdirSync(routesDir).filter((f) => f.endsWith('.jsx')).map((f) => join(routesDir, f)),
    join(shared, 'components', 'PlaceOrderPanel.jsx'),
];

const offenders = [];
let confirmScreens = 0;
for (const path of files) {
    const src = readFileSync(path, 'utf8');
    const idx = src.indexOf('<ActionConfirmScreen');
    if (idx === -1) continue;
    confirmScreens++;
    const el = src.slice(idx, src.indexOf('/>', idx) + 2);
    if (/\bdecoded=/.test(el)) offenders.push(path.split('/').pop());
}
assert.equal(offenders.length, 0,
    `these confirm surfaces still pass a locally-described intent:\n  ${offenders.join('\n  ')}`);
// A floor, so a broken locator cannot make this pass by finding nothing.
assert.ok(confirmScreens >= 25,
    `expected 25+ confirm call sites in the sweep, saw ${confirmScreens}`);

// --- 3. the screen prefers the envelope, and has no other source -----

const screenSrc = read('packages', 'core', 'src', 'shared', 'components', 'ActionConfirmScreen.jsx');
assert.match(screenSrc, /decoded=\{composed\?\.decoded\}/,
    'the confirm screen renders the intent the HOST described, with no caller override');

// --- 4. the dApp approval window describes host-side too -------------

const approval = read('packages', 'extension', 'src', 'approval', 'kinds', 'SignApproval.jsx');
assert.ok(!/decoderLib\.decodeAction/.test(approval),
    'the approval window no longer describes attacker-supplied params with the local describer');
assert.match(approval, /describeActionOnHost\(/,
    'the approval window describes via the action.describe host route');
// Both kinds that show an action intent must go through it.
assert.match(approval, /kind === 'signAction'\n\s*\? \{ action: resolvedPayload\?\.action/,
    'signAction params are described host-side');
assert.match(approval, /coSignPreviewDecodedFrom\(coSignPreview\)/,
    'a co-sign request describes the action the HOST decoded out of the PSBT');

// --- 5. the local describer is preview-only ---------------------------
//
// It may still serve draft previews inside forms. It may not be reachable
// from anything that signs, and no non-form module may import it.

const decoderIdx = read('packages', 'core', 'src', 'decoder', 'index.js');
assert.match(decoderIdx, /export \{ decodeAction \} from '\.\/actionDecoder\.js'/,
    'the local describer is still exported for in-form previews');

const flowsDir = join(wsRoot, 'packages', 'core', 'src', 'flows');
const flowOffenders = readdirSync(flowsDir)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => /actionDecoder\.js|decodeAction\(/.test(readFileSync(join(flowsDir, f), 'utf8')));
assert.equal(flowOffenders.length, 0,
    `flows must describe through the SDK, not the local copy:\n  ${flowOffenders.join('\n  ')}`);

console.log(
    'OK: confirm intent provenance smoke (: host describes the COMPOSED action via sdk.decoder.describe; '
    + `${confirmScreens} confirm call sites pass no locally-described intent; the approval window and co-sign both `
    + 'describe host-side; the wallet-local describer is reachable only from in-form draft previews)',
);
