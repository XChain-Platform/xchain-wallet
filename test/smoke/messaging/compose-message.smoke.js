// Phase 3 Step 13 smoke — Compose flow (§41.7.3).
//
// Asserts:
//   1. messageAction + getRecipientPubkey + PubkeyNotFoundError
//      exported from @xchain-wallet/core with input guards.
//   2. ComposeMessage.jsx exists, debounces the pubkey lookup via
//      messaging.getRecipientPubkey, tracks pubkey state
//      ('idle' | 'checking' | 'found' | 'missing'), offers the
//      unencrypted fallback when pubkey is missing, and signs via
//      SignCredentials with both messageAction + messageActionHw.
//   3. Background host registers action.message, action.message.hw,
//      and messaging.pubkey.
//   4. Three shells' messaging.js expose messageAction,
//      messageActionHw, and getRecipientPubkey.
//   5. Three App.jsx files track the 'compose-message' sub-route and
//      thread onCompose from MessagingInbox.
//   6. MessagingInbox renders a Reply / New conversation button when
//      onCompose prop is provided.

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

// --- 1. Flow exports --------------------------------------------------

assert.equal(typeof flows.messageAction, 'function',
    'flows.messageAction exported');
assert.equal(typeof flows.getRecipientPubkey, 'function',
    'flows.getRecipientPubkey exported');
assert.equal(typeof flows.PubkeyNotFoundError, 'function',
    'flows.PubkeyNotFoundError exported (subclassable)');

await assert.rejects(async () => flows.messageAction(), /opts is required/);
await assert.rejects(
    async () => flows.messageAction({}),
    /destination is required/,
);
await assert.rejects(
    async () => flows.messageAction({ destination: 'bc1q' }),
    /message is required/,
);

await assert.rejects(async () => flows.getRecipientPubkey({}), /sdkRegistry is required/);
await assert.rejects(
    async () => flows.getRecipientPubkey({ sdkRegistry: {} }),
    /chainId is required/,
);
await assert.rejects(
    async () => flows.getRecipientPubkey({ sdkRegistry: {}, chainId: 'x' }),
    /address is required/,
);

// --- 2. ComposeMessage.jsx --------------------------------------------

const formPath = join(sharedRoutes, 'ComposeMessage.jsx');
assert.ok(existsSync(formPath), 'ComposeMessage.jsx exists');
const src = readFileSync(formPath, 'utf8');
assert.ok(/export function ComposeMessage\b/.test(src),
    'ComposeMessage is a named export');
assert.ok(/messaging\.getRecipientPubkey\s*\(/.test(src),
    'ComposeMessage calls messaging.getRecipientPubkey');
for (const state of ['idle', 'checking', 'found', 'missing']) {
    assert.ok(src.includes(`'${state}'`),
        `ComposeMessage tracks pubkey state "${state}"`);
}
assert.ok(/setTimeout\(/.test(src) && /\},\s*400\)/.test(src),
    'ComposeMessage debounces the pubkey lookup (400ms)');
assert.ok(/sendUnencrypted/.test(src) && /Continue anyway/.test(src),
    'ComposeMessage offers the unencrypted fallback on pubkey-missing');
assert.ok(/messaging\.messageAction\s*\(/.test(src)
    && /messaging\.messageActionHw\s*\(/.test(src),
    'ComposeMessage branches messageAction / messageActionHw on isHwSource');
assert.ok(/SignCredentials/.test(src) && /isHwSource/.test(src),
    'ComposeMessage reuses SignCredentials + isHwSource');
assert.ok(/PubkeyNotFoundError/.test(src),
    'ComposeMessage handles PubkeyNotFoundError from the background flow');

// --- 3. Background handlers -------------------------------------------

const bg = readFileSync(join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8');
for (const route of ['action.message', 'action.message.hw', 'messaging.pubkey']) {
    assert.ok(bg.includes(`'${route}'`), `background host registers ${route}`);
}

// --- 4. Three-shell messaging -----------------------------------------

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    for (const fn of ['messageAction', 'messageActionHw', 'getRecipientPubkey']) {
        assert.ok(
            new RegExp(`export function ${fn}\\b`).test(m),
            `${shell} messaging.js exports ${fn}`,
        );
    }
    assert.ok(/sendMessage\('action\.message'/.test(m),
        `${shell} routes messageAction via action.message`);
    assert.ok(/sendMessage\('action\.message\.hw'/.test(m),
        `${shell} routes messageActionHw via action.message.hw`);
    assert.ok(/sendMessage\('messaging\.pubkey'/.test(m),
        `${shell} routes getRecipientPubkey via messaging.pubkey`);
}

// --- 5. App.jsx wiring -------------------------------------------------

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('ComposeMessage'),
        `${shell} App.jsx imports ComposeMessage`);
    assert.ok(app.includes("'compose-message'"),
        `${shell} App.jsx tracks the compose-message sub-route`);
    assert.ok(/composePrefill/.test(app),
        `${shell} App.jsx tracks composePrefill state`);
    assert.ok(/onCompose=/.test(app),
        `${shell} App.jsx threads onCompose to MessagingInbox`);
}

// --- 6. MessagingInbox Reply/New button --------------------------------

const inboxSrc = readFileSync(join(sharedRoutes, 'MessagingInbox.jsx'), 'utf8');
assert.ok(/onCompose/.test(inboxSrc), 'MessagingInbox accepts onCompose prop');
assert.ok(/New conversation/.test(inboxSrc),
    'MessagingInbox renders "New conversation" button when no counterparty selected');
assert.ok(/Reply/.test(inboxSrc),
    'MessagingInbox renders "Reply" button when counterparty selected');

console.log(
    'OK — compose-message smoke (§41.7.3: messageAction + getRecipientPubkey + PubkeyNotFoundError; ComposeMessage debounced pubkey lookup, 4-state UI, unencrypted fallback, SignCredentials gate; background handlers + 3-shell messaging + 3-shell App.jsx + Inbox Reply/New button)',
);
