// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for NFT Phase 2B — attach on-chain artwork to a token from
// ManageToken: FILE upload → wait-for-index → owner-validated LINK
// (the NFT content-attachment pattern, NFT_Standard.md).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flows } from '../../../packages/core/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

const formPath = join(sharedRoutes, 'AttachContentForm.jsx');
assert.ok(existsSync(formPath), 'AttachContentForm.jsx exists');
const src = readFileSync(formPath, 'utf8');

assert.ok(/export function AttachContentForm\b/.test(src),
    'AttachContentForm is a named export');

// Stage machine — two signs with an indexing wait between them.
for (const stage of ['compose', 'review-file', 'wait-index', 'review-link', 'done']) {
    assert.ok(src.includes(`'${stage}'`), `form tracks stage "${stage}"`);
}

// Messaging surface: FILE submit, LINK submit, index polling, genesis
// lookup for the ISSUE leg.
for (const call of [
    'messaging.getAddressesByChain',
    'messaging.getGenesisForToken',
    'messaging.getActionByTxid',
    'messaging.fileAction',
    'messaging.fileActionHw',
    'messaging.linkAction',
    'messaging.linkActionHw',
]) {
    assert.ok(src.includes(call), `AttachContentForm calls ${call}`);
}

// The on-chain push ceiling is enforced in the picker, not after the
// user signed.
assert.ok(/MAX_FILE_BYTES/.test(src), 'form caps the file size pre-sign');

// The LINK is only honoured from the token's owner — the form must
// surface a mismatch instead of failing silently after two signs.
assert.ok(/ownerMismatch/.test(src), 'form warns on issuer/owner mismatch');

// HW vs software signing branches.
assert.ok(/SignCredentials/.test(src), 'form uses SignCredentials');
assert.ok(/isHwSource/.test(src), 'form imports isHwSource for HW branching');

// Watcher mode is blocked (two-phase flow can't cross an air gap).
assert.ok(/isWatcherMode/.test(src), 'form blocks watcher mode');

// --- Core flow ---

assert.equal(typeof flows.fileAction, 'function',
    'flows.fileAction re-exported');
await assert.rejects(
    async () => flows.fileAction({}),
    /fileAction: name is required/,
    'fileAction guards name',
);
await assert.rejects(
    async () => flows.fileAction({ name: 'a.png' }),
    /fileAction: type \(MIME\) is required/,
    'fileAction guards type',
);
await assert.rejects(
    async () => flows.fileAction({ name: 'a.png', type: 'image/png' }),
    /fileAction: rawData \(file bytes\) is required/,
    'fileAction guards rawData',
);
await assert.rejects(
    async () => flows.fileAction({ name: 'a|b.png', type: 'image/png', rawData: 'x' }),
    /cannot contain/,
    'fileAction rejects | and ; in serialized fields',
);

// --- Background host ---

const bg = readFileSync(join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8');
assert.ok(bg.includes("'action.file'"),
    'background host registers action.file');
assert.ok(bg.includes("'action.file.hw'"),
    'background host registers action.file.hw');
assert.ok(/fileAction\b/.test(bg), 'background host imports fileAction');

// --- Shell messaging helpers ---

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    assert.ok(/export function fileAction\b/.test(m),
        `${shell} messaging.js exports fileAction`);
    assert.ok(/export function fileActionHw\b/.test(m),
        `${shell} messaging.js exports fileActionHw`);
}

// --- ManageToken entry (owner-gated) + App.jsx wiring (3 shells) ---

const manageSrc = readFileSync(join(sharedRoutes, 'ManageToken.jsx'), 'utf8');
assert.ok(/onAttachContent/.test(manageSrc), 'ManageToken accepts onAttachContent');
assert.ok(/id:\s*['"]attach-content['"]/.test(manageSrc),
    'ManageToken renders the Artwork action');
assert.ok(/blockIssuerActions \? undefined : onAttachContent/.test(manageSrc),
    'ManageToken hides Artwork from non-owners');

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('AttachContentForm'),
        `${shell} App.jsx imports AttachContentForm`);
    assert.ok(app.includes("'attach-content'"),
        `${shell} tracks 'attach-content' sub-route`);
    assert.ok(/onAttachContent=\{\(\) => openForm\('attach-content'\)\}/.test(app),
        `${shell} ManageToken wires onAttachContent`);
    assert.ok(/<AttachContentForm\b[\s\S]*?issuerAddress=\{tokenDetailRef\.issuer/.test(app),
        `${shell} App.jsx mounts <AttachContentForm> with the resolved issuer`);
}

console.log(
    'OK — attach-content smoke (AttachContentForm stage machine FILE → wait-index → LINK, size cap + owner-mismatch warning + watcher block, fileAction core flow guards, bg handlers, 3-shell messaging + App.jsx wiring, owner-gated ManageToken entry)',
);
