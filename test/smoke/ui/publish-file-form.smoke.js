// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-28 (unified "Publish file" upload): a general publish
// surface reachable from ActionsMenu in all three shells with an
// explicit Public vs Encrypted-and-token-gated mode choice. The
// Encrypted mode routes into the PC-25 composition core
// (GatedPublishForm) behind an owned-ticks-only gate picker; size
// limits are encoding-aware (flows/fileSizeLimits.js), not the old
// flat 7000-byte guess; and the watcher path composes through the
// SAME params helper the signing path submits.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { surfacesEntry } from '../_action-entries.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

// ---- The form itself ----------------------------------------------------
const form = read('packages', 'core', 'src', 'shared', 'routes', 'PublishFileForm.jsx');
assert.match(form, /value: 'public'/, 'Public mode option present');
assert.match(form, /value: 'gated'/, 'Encrypted mode option present');
assert.match(form, /useState\(\/\*\* @type \{'public' \| 'gated'\} \*\/ \('public'\)\)/,
    'Public is the default mode');
// Encrypted mode is the PC-25 composition core drawn as this page, handed
// the draft; its gate picker enumerates OWNED ticks only (issuer-only rule).
assert.match(form, /<GatedPublishForm/, 'Encrypted mode routes into the PC-25 composition core');
assert.match(form, /shared=\{\{\s*fileMeta,\s*setFileMeta,\s*title,\s*setTitle,\s*memo,\s*setMemo,/,
    'the file, title and memo carry into Encrypted mode');
assert.match(form, /maxPublicFileBytes/, 'public lane uses the encoding-aware ceiling');
assert.match(form, /fileActionParams/,
    'watcher branch composes via the shared params helper (no drift vs fileAction)');
assert.match(form, /buildActionPsbtRequest/, 'watcher path builds an unsigned PSBT');
assert.match(form, /ResultScreen/, 'watcher result surface rendered');
assert.doesNotMatch(form, /ackForever/, 'no acknowledgement checkbox gates review');
assert.match(form, /notice: `\$\{upload\.confirmLine\} \$\{t\('publishFile\.confirm\.notice'\)\}`/,
    'the confirm screen names the upload method and states the permanence');
assert.match(form, /t\('publishFile\.review\.permanent'\)/, 'watcher review keeps its permanence line');
assert.match(form, /t\('publishFile\.metadataTooLarge'/,
    'review re-checks the ceiling after metadata edits');
assert.match(form, /fileActionHw/, 'HW signing path wired');
assert.match(form, /SignCredentials/, 'standard signing surface used');
// The PC-29 threshold field lives in GatedPublishForm (behind its
// activation gate; see gated-threshold.smoke.js), which the Encrypted
// lane routes into. PublishFileForm itself must stay threshold-free -
// duplicating the field here would bypass the gate.
const formCode = form.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
assert.doesNotMatch(formCode, /GATE_MIN_AMOUNT|threshold/i,
    'PublishFileForm delegates the PC-29 threshold to GatedPublishForm');
// The confirm lane carries the envelope's commit, reveal and recovery record, so
// the public lane offers the envelope as an Upload method the user picks. The
// cap and the compose must agree: both follow the one picked method from the
// shared hook, and AUTO is sent with the signer's tapscript capability asserted
// rather than assumed (flows/uploadMethod.js).
assert.match(formCode, /useUploadMethod\(\{[\s\S]{0,200}isWatcherMode,/,
    'the upload method hears the wallet mode, so the watch-only lane never gets the envelope');
assert.match(formCode, /maxPublicFileBytes\([\s\S]{0,120}upload\.ceilingOpts/,
    'public publish cap is sized for the picked upload method');
assert.match(formCode, /encoderOpts: \{[\s\S]{0,400}\.\.\.upload\.encoderOpts,/,
    'confirm-lane compose sends the picked upload method request');
assert.doesNotMatch(formCode, /encoding:\s*'(AUTO|TAPROOT)'/,
    'the form never spells an encoding itself; the upload method helper owns the request');
const uploadMethod = read('packages', 'core', 'src', 'flows', 'uploadMethod.js');
assert.match(uploadMethod, /\{ encoding: 'AUTO', options: encoderSignerOptions\(fromAddress\) \}/,
    'the Taproot method requests AUTO with the signer capability asserted');
assert.match(uploadMethod, /if \(isWatcherMode\) return 'watcher';/,
    'the envelope is refused on the watch-only lane, whose single PSBT cannot carry a reveal');
assert.match(uploadMethod, /if \(!envelopeAvailableFor\(descriptor, fromAddress\)\) return 'signer';/,
    'the envelope is offered only to a tapscript-capable signer');

// ---- Encoding-aware limits module --------------------------------------
const limits = read('packages', 'core', 'src', 'flows', 'fileSizeLimits.js');
assert.match(limits, /MAX_COMPILED_ACTION_BYTES = 8192/, 'compiled-push ceiling pinned to consensus value');
assert.match(limits, /ECIES_HANDOFF_HEX_CHARS = 190/, 'handoff width pinned');
assert.match(limits, /AES_GCM_ENVELOPE_BYTES = 28/, 'AES envelope pinned');

// The gated flow enforces the computed ceiling (not just the UI).
const gatedFlow = read('packages', 'core', 'src', 'flows', 'gatedPublishAction.js');
assert.match(gatedFlow, /maxGatedPlaintextBytes\(\{/, 'gated flow enforces the computed ceiling');

// The gated form computes its cap live instead of the static floor.
const gatedForm = read('packages', 'core', 'src', 'shared', 'routes', 'GatedPublishForm.jsx');
assert.match(gatedForm, /maxGatedPlaintextBytes/, 'gated form shows the live computed cap');

// flows index exports the helpers the forms consume via flowsLib.
const flowsIndex = read('packages', 'core', 'src', 'flows', 'index.js');
for (const name of ['fileActionParams', 'maxPublicFileBytes', 'maxGatedPlaintextBytes']) {
    assert.match(flowsIndex, new RegExp(name), `flows index exports ${name}`);
}

// ---- Three-shell wiring -------------------------------------------------
const shells = [
    ['packages', 'web', 'src', 'App.jsx'],
    ['packages', 'desktop', 'renderer', 'App.jsx'],
    ['packages', 'extension', 'src', 'popup', 'App.jsx'],
];
for (const p of shells) {
    const src = read(...p);
    const label = p.join('/');
    assert.match(src, /import \{ PublishFileForm \}|const PublishFileForm = lazyRoute\(\(\) => import\('@xchain-wallet\/core\/shared\/routes\/PublishFileForm\.jsx'\)/, `${label}: form imported`);
    assert.match(src, /'publish-file'/, `${label}: view id registered`);
    assert.match(src, /unlockedView === 'publish-file'/, `${label}: view dispatched`);
    assert.match(src, /onPublishFile/, `${label}: ActionsMenu entry wired`);
    assert.ok(surfacesEntry(src, 'publish-file', 'Publish file'),
        `${label}: entry present in the shared menu and armed here`);
}

// ---- Command palette ----------------------------------------------------
const palette = read('packages', 'core', 'src', 'shared', 'commandPalette', 'commandRegistry.js');
assert.match(palette, /create-publish-file/, 'palette entry present');
assert.match(palette, /go\('publish-file'\)/, 'palette routes to the view');

console.log('publish-file-form smoke: all assertions passed');
