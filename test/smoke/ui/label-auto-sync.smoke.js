// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §19.5.2 label AUTO-sync (the on-vault-write half).
//
// The decided shape: keep prompting for the seed rather than caching
// it, and batch label edits into ONE publish per unlock window. This
// smoke checks the wiring that shape needs end to end:
//   1. The core scheduler exists and is re-exported from flows.
//   2. Every label / contact vault write in the background host
//      notifies it, and a successful publish clears the batch.
//   3. Both shells expose the status + dismiss messaging.
//   4. The Backup panel raises the prompt instead of publishing
//      silently, and no path caches a password or seed to do it.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');

// --- 1. Core scheduler ---------------------------------------------------

const flow = readFileSync(join(core, 'src', 'flows', 'labelSync.js'), 'utf8');
assert.ok(
    /export function createLabelSyncScheduler\b/.test(flow),
    'labelSync.js exports createLabelSyncScheduler',
);
assert.ok(
    /export const LABEL_SYNC_AUTO_DEBOUNCE_MS/.test(flow)
        && /export const LABEL_SYNC_AUTO_MAX_WAIT_MS/.test(flow),
    'the debounce quiet period and the max-wait ceiling are both named constants',
);
for (const method of [
    'noteLabelChange', 'beginUnlockWindow', 'endUnlockWindow',
    'markPublished', 'status', 'flush', 'dispose',
]) {
    assert.ok(
        new RegExp(`\\b${method}\\s*[(:]`).test(flow),
        `scheduler exposes ${method}`,
    );
}
assert.ok(
    /attemptWindowId === windowId/.test(flow),
    'the one-publish-per-unlock-window cap is enforced by window id, not by a timer',
);
assert.ok(
    /SECRET_KEYS/.test(flow)
        && /never holds secrets/.test(flow),
    'noteLabelChange refuses secret-shaped input so the scheduler cannot start caching a seed',
);

const flowsIndex = readFileSync(join(core, 'src', 'flows', 'index.js'), 'utf8');
assert.ok(
    /createLabelSyncScheduler/.test(flowsIndex),
    'flows/index.js re-exports createLabelSyncScheduler',
);

// --- 2. Background host wiring -------------------------------------------

const bg = readFileSync(
    join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8',
);
assert.ok(
    /createLabelSyncScheduler\s*\(/.test(bg),
    'the background host builds one scheduler per host (a host IS an unlock window)',
);
assert.ok(
    /labelsSurviveRestore\s*===\s*true/.test(bg),
    'auto-sync is gated on the settings.privacy.labelsSurviveRestore opt-in',
);
assert.ok(
    /host\.register\('wallet\.labelSyncStatus'/.test(bg),
    'background host registers wallet.labelSyncStatus',
);
assert.ok(
    /host\.register\('wallet\.labelSyncDismiss'/.test(bg),
    'background host registers wallet.labelSyncDismiss',
);
assert.ok(
    /labelSyncScheduler\.markPublished\(\)/.test(bg),
    'a successful wallet.publishLabels marks the batch published (manual publish satisfies auto-sync)',
);
// Every vault write that lands in the §19.5.2 payload must notify.
const setLabelHandler = bg.slice(bg.indexOf("host.register('addresses.setLabel'"));
assert.ok(
    /noteLabelChange\(/.test(setLabelHandler.slice(0, 900)),
    'addresses.setLabel notifies the scheduler',
);
const contactsSave = bg.slice(bg.indexOf("host.register('contacts.save'"));
assert.ok(
    /noteLabelChange\(/.test(contactsSave.slice(0, 500)),
    'contacts.save notifies the scheduler',
);
const contactsDelete = bg.slice(bg.indexOf("host.register('contacts.delete'"));
assert.ok(
    /noteLabelChange\(/.test(contactsDelete.slice(0, 400)),
    'contacts.delete notifies the scheduler',
);
// The background must never be able to publish on its own: that would
// need a cached seed, which is exactly what the decision rules out.
assert.ok(
    !/labelSyncScheduler[\s\S]{0,400}publishLabelsNow\s*\(/.test(bg),
    'the scheduler never calls publishLabelsNow itself; it only raises a prompt',
);

// --- 3. Messaging surface ------------------------------------------------

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    assert.ok(
        /export function labelSyncStatusRequest\b/.test(m)
            && /sendMessage\('wallet\.labelSyncStatus'/.test(m),
        `${shell} messaging.js exposes labelSyncStatusRequest`,
    );
    assert.ok(
        /export function labelSyncDismissRequest\b/.test(m)
            && /sendMessage\('wallet\.labelSyncDismiss'/.test(m),
        `${shell} messaging.js exposes labelSyncDismissRequest`,
    );
}

// --- 4. Backup panel prompt ----------------------------------------------

const bs = readFileSync(
    join(core, 'src', 'shared', 'components', 'settings', 'BackupSection.jsx'),
    'utf8',
);
assert.ok(
    /labelSyncStatusRequest\(\)/.test(bs),
    'BackupSection polls the auto-sync status',
);
assert.ok(
    /function LabelSyncDueNotice\b/.test(bs)
        && /<LabelSyncDueNotice\b/.test(bs),
    'BackupSection renders the due notice',
);
assert.ok(
    /labelSyncDismissRequest/.test(bs),
    'the notice can be dismissed for this unlock window',
);
assert.ok(
    /setPublishStage\('form'\)/.test(bs),
    'the notice opens the existing publish form, which asks for the password',
);
assert.ok(
    !/labelSyncStatusRequest[\s\S]{0,600}password:/.test(bs),
    'the auto-sync path carries no password of its own',
);

console.log('label-auto-sync smoke: OK');
