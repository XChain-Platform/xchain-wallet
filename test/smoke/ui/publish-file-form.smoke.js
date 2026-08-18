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
assert.match(form, /value="public"/, 'Public mode option present');
assert.match(form, /value="gated"/, 'Encrypted mode option present');
assert.match(form, /useState\(\/\*\* @type \{'public' \| 'gated'\} \*\/ \('public'\)\)/,
    'Public is the default mode');
assert.match(form, /getOwnedTokens/, 'gate picker enumerates OWNED ticks only (issuer-only rule)');
assert.match(form, /<GatedPublishForm/, 'Encrypted mode routes into the PC-25 composition core');
assert.match(form, /maxPublicFileBytes/, 'public lane uses the encoding-aware ceiling');
assert.match(form, /fileActionParams/,
    'watcher branch composes via the shared params helper (no drift vs fileAction)');
assert.match(form, /buildActionPsbtRequest/, 'watcher path builds an unsigned PSBT');
assert.match(form, /WatcherResultPanel/, 'watcher result surface rendered');
assert.match(form, /ackForever/, 'irreversibility acknowledgment gates review');
assert.match(form, /on-chain forever/, 'permanence copy present');
assert.match(form, /Shorten the title or memo/,
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
    assert.match(src, /import \{ PublishFileForm \}/, `${label}: form imported`);
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
