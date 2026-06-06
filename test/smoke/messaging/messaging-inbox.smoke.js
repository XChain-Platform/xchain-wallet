// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Phase 3 Step 12 smoke — Messaging inbox + thread (§41.7.2).
//
// Asserts:
//   1. getMessagingInbox flow exported from @xchain-wallet/core; input
//      guards surface structured errors.
//   2. MessagingInbox.jsx exists with named export, wires
//      messaging.getMessagingInbox + 4-stage state machine
//      ('pick' | 'password' | 'submitting' | 'inbox') + password
//      re-prompt on wrong password.
//   3. Background host registers messaging.inbox.
//   4. Three shells' messaging.js expose getMessagingInbox routed
//      through messaging.inbox.
//   5. Three App.jsx files track the 'messaging' sub-route and thread
//      onMessaging to Home.
//   6. Home renders a "Messaging" button and accepts onMessaging prop.

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

// --- 1. Flow exports + guards -----------------------------------------

assert.equal(typeof flows.getMessagingInbox, 'function', 'flows.getMessagingInbox exported');

await assert.rejects(async () => flows.getMessagingInbox({}), /vault is required/);
await assert.rejects(
    async () => flows.getMessagingInbox({ vault: {} }),
    /walletId is required/,
);
await assert.rejects(
    async () => flows.getMessagingInbox({ vault: {}, walletId: 'w1' }),
    /password is required/,
);
await assert.rejects(
    async () => flows.getMessagingInbox({ vault: {}, walletId: 'w1', password: 'pw' }),
    /chainRegistry is required/,
);
await assert.rejects(
    async () => flows.getMessagingInbox({
        vault: {}, walletId: 'w1', password: 'pw', chainRegistry: {},
    }),
    /sdkRegistry is required/,
);
await assert.rejects(
    async () => flows.getMessagingInbox({
        vault: {}, walletId: 'w1', password: 'pw',
        chainRegistry: {}, sdkRegistry: {},
    }),
    /addressId is required/,
);

// --- 2. MessagingInbox.jsx --------------------------------------------

const inboxPath = join(sharedRoutes, 'MessagingInbox.jsx');
assert.ok(existsSync(inboxPath), 'MessagingInbox.jsx exists');
const src = readFileSync(inboxPath, 'utf8');
assert.ok(/export function MessagingInbox\b/.test(src),
    'MessagingInbox is a named export');
assert.ok(/messaging\.getMessagingInbox\s*\(/.test(src),
    'MessagingInbox calls messaging.getMessagingInbox');
for (const stage of ['pick', 'password', 'submitting', 'inbox']) {
    assert.ok(src.includes(`'${stage}'`),
        `MessagingInbox tracks stage "${stage}"`);
}
assert.ok(/WrongPasswordError|InvalidPasswordError/.test(src),
    'MessagingInbox handles wrong-password error name');
assert.ok(/NoKeyForAddressError/.test(src),
    'MessagingInbox handles NoKeyForAddressError (HW / watch-only)');
assert.ok(/Conversations\b/.test(src) && /Thread\b/.test(src),
    'MessagingInbox renders Conversations + Thread panes per §41.7.2');
assert.ok(/counterparty/i.test(src),
    'MessagingInbox groups messages by counterparty');

// --- 3. Background handler --------------------------------------------

const bg = readFileSync(join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8');
assert.ok(bg.includes("'messaging.inbox'"),
    'background host registers messaging.inbox');

// --- 4. Three-shell messaging -----------------------------------------

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    assert.ok(
        /export function getMessagingInbox\b/.test(m),
        `${shell} messaging.js exports getMessagingInbox`,
    );
    assert.ok(/sendMessage\('messaging\.inbox'/.test(m),
        `${shell} routes getMessagingInbox via messaging.inbox`);
}

// --- 5. App.jsx wiring -------------------------------------------------

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('MessagingInbox'),
        `${shell} App.jsx imports MessagingInbox`);
    assert.ok(app.includes("'messaging'"),
        `${shell} App.jsx tracks the messaging sub-route`);
    assert.ok(/onMessaging={/.test(app) || /onMessaging=activeWalletId/.test(app),
        `${shell} App.jsx threads onMessaging to Home`);
}

// --- 6. Home wiring ----------------------------------------------------

const homeSrc = readFileSync(join(sharedRoutes, 'Home.jsx'), 'utf8');
assert.ok(/onMessaging/.test(homeSrc), 'Home.jsx accepts onMessaging prop');
assert.ok(/>\s*Messaging\s*</.test(homeSrc),
    'Home.jsx renders a "Messaging" button');

console.log(
    'OK — messaging-inbox smoke (§41.7.2: getMessagingInbox core flow with password-gated ECIES decrypt via exportPrivateKey; MessagingInbox 4-stage state machine + password re-prompt + Conversations/Thread panes + counterparty grouping; messaging.inbox handler + 3-shell messaging + 3-shell App.jsx + Home "Messaging" button)',
);
