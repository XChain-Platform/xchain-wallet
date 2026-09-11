// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Phase 3 Step 12 smoke: Messaging inbox + thread (§41.7.2).
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
// 7. sweepMsgMemoryForWallet actually removes every
//      xc:msgRead: / xc:msgUnread: key for a walletId, across multiple
//      accounts, and is wired into all 3 wallet-removal entry points.

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
    /password.*required|signer.*required/,
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
assert.ok(/messaging\.getMessagingInboxSweep\s*\(/.test(src),
    'MessagingInbox calls messaging.getMessagingInboxSweep');
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

// --- 2b. Encrypted-session reply (format-1 handshake) -----------------

assert.ok(/function SessionRequestRow\b/.test(src),
    'MessagingInbox defines SessionRequestRow for encrypted-session replies');
assert.ok(/messaging\.sendHandshake\s*\(/.test(src),
    'MessagingInbox reply calls messaging.sendHandshake');
assert.ok(/version:\s*1/.test(src),
    'MessagingInbox reply sends a format-1 (response) handshake');
assert.ok(/Share my key/.test(src),
    'MessagingInbox renders a "Share my key" reply action');
assert.ok(/useSignerReady\b/.test(src),
    'MessagingInbox uses signer-ready state to gate the inline password prompt');

// --- 2c. Docked composer hands replies to the New-message form --------

assert.ok(/function ThreadComposer\b/.test(src),
    'MessagingInbox defines ThreadComposer (docked message input)');
assert.ok(/onSubmit=\{\(\) => \{/.test(src) && /onCompose\(\{/.test(src),
    'composer Enter routes the draft to the New-message form via onCompose');
assert.ok(/toAddress: selectedCounterparty/.test(src) && /message: t,/.test(src),
    'the reply prefill carries the recipient and the typed body');
assert.ok(/fixedEncryption: threadEncryption/.test(src) && /threadEncryption\b/.test(src),
    'the reply locks the conversation encryption method onto the form');
assert.ok(/className=\{local\.composerInput\}/.test(src) && /className=\{local\.composerSend\}/.test(src),
    'composer pairs a message input with a send button');
assert.ok(/className=\{local\.composerSend\} aria-label="Send message"/.test(src),
    'the composer send button is labelled and submits the form (Enter or click)');
assert.ok(!/function SendConfirm\b/.test(src) && !/messaging\.messageAction\s*\(/.test(src),
    'the bespoke SendConfirm screen is gone; ComposeMessage is the single send surface');
assert.ok(!/>\s*Reply\s*</.test(src),
    'the old Reply button is removed from the thread view');

// Every shell forwards the reply prefill (body + locked encryption) into
// ComposeMessage.
{
    const shells = [
        join(web, 'src', 'App.jsx'),
        join(ext, 'src', 'popup', 'App.jsx'),
        join(desktop, 'renderer', 'App.jsx'),
    ];
    for (const p of shells) {
        const app = readFileSync(p, 'utf8');
        assert.ok(/initialMessage=\{composePrefill\?\.message\}/.test(app)
            && /fixedEncryption=\{composePrefill\?\.fixedEncryption\}/.test(app),
            `${p} forwards message + fixedEncryption prefills to ComposeMessage`);
    }
}

// --- 2d. iMessage-style day separators --------------------------------

assert.ok(/buildThreadItems\b/.test(src),
    'MessagingInbox groups thread messages into day-separated items');
assert.ok(/function formatDaySeparator\b/.test(src) && /'Today'/.test(src) && /'Yesterday'/.test(src),
    'day separator labels Today / Yesterday and dates');
assert.ok(/local\.daySeparator/.test(src),
    'thread renders a day-separator row');
assert.ok(/function formatTime\b/.test(src),
    'message bubbles show a per-message time-of-day caption');

// --- 2e. iMessage-style bubbles ---------------------------------------

assert.ok(/borderRadius: '1\.1rem'/.test(src) && /maxWidth: '75%'/.test(src),
    'message rows render as rounded bubbles that shrink to fit, capped at 75% width');
assert.ok(/alignItems: isOutgoing \? 'flex-end' : 'flex-start'/.test(src),
    'outgoing bubbles align right, incoming align left');
assert.ok(!/#0b84ff/.test(src) && /var\(--xc-accent-primary\)/.test(src),
    'message bubbles use theme colors, not hardcoded hex');

// --- 2f. Read / unread tracking ---------------------------------------

assert.ok(/readMsgRead\b/.test(src) && /writeMsgRead\b/.test(src),
    'MessagingInbox loads + persists per-conversation read marks');
assert.ok(/lastIncomingTimestamp\b/.test(src),
    'conversations track their newest incoming message for unread detection');
assert.ok(/local\.unreadDot\b/.test(src),
    'the conversation list shows an unread dot');
assert.ok(/function openConversation\b/.test(src) && /setSelectedCounterparty\(/.test(src),
    'opening a conversation goes straight to the thread and clears the read mark');
assert.ok(/Unread messages/.test(src) && /firstUnreadRef\b/.test(src),
    'the thread marks where unread messages begin and scrolls there on open');

// --- 2g. App-level unread snapshot ------------------------------------

assert.ok(/writeMsgUnread\b/.test(src),
    'MessagingInbox publishes the account unread count for app-level surfaces');
{
    const utils = readFileSync(join(core, 'src', 'shared', 'utils', 'msgReadMemory.js'), 'utf8');
    assert.ok(/export function readMsgUnread\b/.test(utils) && /export function writeMsgUnread\b/.test(utils),
        'msgReadMemory exposes the unread-count snapshot read/write');
    const hook = readFileSync(join(core, 'src', 'shared', 'hooks', 'useMessagingUnread.js'), 'utf8');
    assert.ok(/export function useMessagingUnread\b/.test(hook) && /MSG_UNREAD_EVENT/.test(hook),
        'useMessagingUnread reads the snapshot and refreshes on the publish event');
}

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
assert.ok(/>\s*Messaging\b/.test(homeSrc),
    'Home.jsx renders a "Messaging" button');

// --- 7. wallet-removal sweep -----------------------------------

// 7a. Behavioral: sweep actually clears every key, across accounts, and
// notifies the unread-badge listener, using a minimal localStorage/window
// stand-in so this runs the real code path rather than grepping for it.
{
    /** @type {Map<string, string>} */
    const store = new Map();
    const fakeLocalStorage = {
        getItem(k) { return store.has(k) ? store.get(k) : null; },
        setItem(k, v) { store.set(k, String(v)); },
        removeItem(k) { store.delete(k); },
        get length() { return store.size; },
        key(i) { return Array.from(store.keys())[i] ?? null; },
    };
    const priorLS = globalThis.localStorage;
    const priorWindow = globalThis.window;
    globalThis.localStorage = fakeLocalStorage;
    let dispatched = [];
    globalThis.window = {
        dispatchEvent(evt) { dispatched.push(evt); },
        addEventListener() {},
        removeEventListener() {},
    };
    try {
        const {
            readMsgRead, writeMsgRead, readMsgUnread, writeMsgUnread,
            sweepMsgMemoryForWallet, MSG_UNREAD_EVENT,
        } = await import('../../../packages/core/src/shared/utils/msgReadMemory.js');

        assert.equal(typeof sweepMsgMemoryForWallet, 'function',
            'msgReadMemory exports sweepMsgMemoryForWallet');

        // Two accounts on wallet A, one on wallet B, to prove the sweep
        // is scoped to the removed wallet and covers every account on it.
        writeMsgRead('walletA', 'acct1', { cp1: ['tx1'] });
        writeMsgRead('walletA', 'acct2', { cp2: ['tx2'] });
        writeMsgRead('walletA', null, { cp3: ['tx3'] }); // 'default' scope
        writeMsgUnread('walletA', 'acct1', 3);
        writeMsgUnread('walletA', 'acct2', 1);
        writeMsgRead('walletB', 'acct1', { cp4: ['tx4'] });
        writeMsgUnread('walletB', 'acct1', 5);

        const removed = sweepMsgMemoryForWallet('walletA');
        assert.equal(removed, 5, 'sweep removes all 5 walletA keys (3 msgRead scopes + 2 msgUnread scopes)');

        assert.deepEqual(readMsgRead('walletA', 'acct1'), {}, 'walletA acct1 read marks gone');
        assert.deepEqual(readMsgRead('walletA', 'acct2'), {}, 'walletA acct2 read marks gone');
        assert.deepEqual(readMsgRead('walletA', null), {}, 'walletA default-scope read marks gone');
        assert.equal(readMsgUnread('walletA', 'acct1'), 0, 'walletA acct1 unread count gone');
        assert.equal(readMsgUnread('walletA', 'acct2'), 0, 'walletA acct2 unread count gone');

        // walletB, a different wallet, must survive the sweep untouched.
        assert.deepEqual(readMsgRead('walletB', 'acct1'), { cp4: ['tx4'] },
            'a different wallet (walletB) is not touched by walletA\'s sweep');
        assert.equal(readMsgUnread('walletB', 'acct1'), 5,
            'walletB unread count is not touched by walletA\'s sweep');

        assert.ok(dispatched.some((e) => e.type === MSG_UNREAD_EVENT),
            'sweep dispatches MSG_UNREAD_EVENT so a mounted nav badge refreshes without reload');
    } finally {
        globalThis.localStorage = priorLS;
        globalThis.window = priorWindow;
    }
}

// 7b. Static: the sweep is actually wired into all 3 removal entry points.
{
    const thisWalletSrc = readFileSync(
        join(core, 'src', 'shared', 'components', 'settings', 'ThisWalletSection.jsx'), 'utf8',
    );
    assert.ok(/sweepMsgMemoryForWallet\(activeWallet\.id\)/.test(thisWalletSrc),
        'ThisWalletSection onConfirmRemove sweeps messaging memory for the removed wallet');

    const demoGradSrc = readFileSync(
        join(core, 'src', 'shared', 'utils', 'demoGraduation.js'), 'utf8',
    );
    assert.ok(/sweepMsgMemoryForWallet\(walletId\)/.test(demoGradSrc),
        'exitDemoWallet sweeps messaging memory for the removed demo wallet');

    const lockedSrc = readFileSync(join(sharedRoutes, 'Locked.jsx'), 'utf8');
    assert.ok(
        (lockedSrc.match(/sweepMsgMemoryForWallet\(demoWalletId\)/g) || []).length >= 2,
        'Locked.jsx handleExitDemo sweeps messaging memory on both the surgical-remove and full-wipe fallback paths',
    );
}

console.log(
    'OK: messaging-inbox smoke (§41.7.2: getMessagingInbox core flow with password-gated ECIES decrypt via exportPrivateKey; MessagingInbox 4-stage state machine + password re-prompt + Conversations/Thread panes + counterparty grouping; messaging.inbox handler + 3-shell messaging + 3-shell App.jsx + Home "Messaging" button; wallet-removal sweep of xc:msgRead:/xc:msgUnread: at all 3 entry points)',
);
