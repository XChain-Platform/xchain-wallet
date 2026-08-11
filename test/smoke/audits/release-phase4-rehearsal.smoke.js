// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// row 89. "Ceremony Phase 4 is rehearsed" is a claim about a tree,
// and this repo's trees move. This gate makes the claim expire on its own.
//
// THE HISTORY THAT BOUGHT IT. Phase 4 was rehearsed by hand at S38, S40, S41
// and S47, and at three of those four the previous rehearsal had already been
// invalidated by commits nobody connected to it:
//
//   S40 found S38's rehearsal had been driven against the wrong tree.
//   S41 (row 61) found "the commit a tag would now name rewrote the entire
//       signing path underneath that rehearsal".
//   S47 found the same decay six commits later - sign.sh +100 lines, lib.sh
//       +177, shipped-lanes.txt 28 lines changed - by diffing a ref out of a
//       frontier row's evidence cell, which is not a mechanism.
//
// WHAT THIS GATE DOES NOT DO, stated plainly because the alternative is a
// check people learn to ignore. It does NOT assert that Phase 4 passes: it
// cannot, because the signature step needs K1's passphrase at a pinentry and
// no CI run can supply one. It asserts something narrower and checkable: that
// the signing path the ceremony would run TODAY is byte-identical to the one
// last actually observed. When it goes red the answer is not to edit the pin
// (that turns an observation into an assertion) but to re-drive the rehearsal
// or to record why the change cannot reach the signing path.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { drift, PIN_PATH, SCRIPT_PATH_FILES } from '../../../tools/release/phase4-rehearsal.mjs';

assert.ok(existsSync(PIN_PATH),
    `no Phase 4 rehearsal pin at ${PIN_PATH}. Nothing would record which commit the signing path was `
    + 'last observed at, which is the state that let the anchor rot three times over four stages. '
    + 'Drive `node tools/release/phase4-rehearsal.mjs pin --repo <tree at the tag> --tag <vX.Y.Z> '
    + '--input <staged dir>` and commit what it writes.');

const pin = JSON.parse(readFileSync(PIN_PATH, 'utf8'));

// The pin must carry BOTH refs. A Phase 4 run reads its scripts from the
// invoking checkout and its lane roster from the --repo tree, and rows 40, 48
// and 57 were each one half of that split being mistaken for the whole.
assert.ok(pin.scriptRef && pin.repoRef,
    'the rehearsal pin names fewer than two refs. A Phase 4 signing run reads from two trees at once '
    + '(scripts from the invoking checkout, lane roster and dev-mock gate from the --repo tree at the '
    + 'tag), so a pin naming one of them describes half the run and hides the half that has broken '
    + 'before.');

// A pin nobody can act on is worse than none: it reads like proof.
assert.ok(typeof pin.reached === 'string' && pin.reached.length > 0,
    'the rehearsal pin does not say how deep the rehearsal got. "Rehearsed" has meant four different '
    + 'depths across this spec\'s stages, which is exactly why the depth is recorded rather than implied.');

assert.ok(Object.keys(pin.scriptPath || {}).length === SCRIPT_PATH_FILES.length,
    `the rehearsal pin records ${Object.keys(pin.scriptPath || {}).length} signing-path files, not the `
    + `${SCRIPT_PATH_FILES.length} this tool tracks. A file dropped from the pin is drift that nothing `
    + 'will ever see, and it fails silently in the direction that looks green.');

const d = drift();

assert.ok(!d.missing, 'the pin vanished between two reads of the same file.');

assert.equal(d.moved.length, 0,
    'the release signing path has moved since the last observed Phase 4 rehearsal:\n  '
    + d.moved.map((m) => m.path).join('\n  ')
    + `\n\nThe rehearsal pinned at ${String(pin.scriptRef).slice(0, 8)} (reached '${pin.reached}', `
    + `observed ${pin.observedAt}) no longer describes the tooling ceremony Phase 4 would run, so any `
    + 'claim that Phase 4 is rehearsed is a claim about a tree that has moved on. Re-drive the rehearsal '
    + 'and re-pin it, or record in the release record why these changes cannot affect signing. Do NOT '
    + 'hand-edit the pin: the whole value of that file is that only an observation can set it.');

console.log(`OK: release phase4-rehearsal smoke ( row 89: the signing path at HEAD is `
    + `byte-identical to the rehearsal observed ${pin.observedAt}; pinned at script `
    + `${String(pin.scriptRef).slice(0, 8)} / repo ${String(pin.repoRef).slice(0, 8)}, tag ${pin.tag}, `
    + `lane ${pin.lane || 'all'}, reached '${pin.reached}'`
    + `${pin.reachedSignature ? '' : ' - short of the signature, which needs K1 at a pinentry'}; `
    + `${SCRIPT_PATH_FILES.length} signing-path files tracked)`);
