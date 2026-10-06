// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Pins the order of signer-bridge teardown versus re-registration when a
// desktop window reloads: the old document's teardown (did-navigate) must
// land before the new document's register, the old transport must reject its
// in-flight request and never be the one the registry serves afterwards, and
// a late second document-end event must not strand the new registration.
// Also pins that index.js attaches the listener before the first window.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as bgSignerBridge from
    '@xchain-wallet/extension/src/background/signerBridge.js';
import { attachSignerBridgeListener } from
    '../../../packages/desktop/main/signerBridgeListener.js';

const CH = 'xchain-wallet:signer-bridge';

function createFakeIpcMain() {
    const set = new Set();
    return {
        on(channel, fn) { if (channel === CH) set.add(fn); },
        off(channel, fn) { if (channel === CH) set.delete(fn); },
        emit(event, msg) { for (const fn of [...set]) fn(event, msg); },
    };
}

function createFakeWebContents(id) {
    const listeners = new Map();
    const sent = [];
    const wc = {
        id,
        isDestroyed() { return false; },
        send(channel, msg) { sent.push({ channel, msg }); },
        on(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev).add(fn); },
        removeListener(ev, fn) { listeners.get(ev)?.delete(fn); },
        emit(ev) { for (const fn of [...(listeners.get(ev) || [])]) fn(); },
        count(ev) { return listeners.get(ev)?.size ?? 0; },
        sent,
    };
    return wc;
}

const ID = 'sig-reload-order';
const req = { op: 'signPsbt', payload: { signerId: ID } };

bgSignerBridge.clearAll();
const ipc = createFakeIpcMain();
const detach = attachSignerBridgeListener({ ipcMain: ipc });
const wc = createFakeWebContents(7);
const register = () => ipc.emit({ sender: wc }, { kind: 'register', signerIds: [ID] });

// Document A registers and has a sign request in flight.
register();
const oldTransport = bgSignerBridge.getTransport(ID);
assert.equal(typeof oldTransport, 'function', 'document A registered');
const inflightA = oldTransport(req);
const sentBeforeReload = wc.sent.length;

// Reload commits: teardown runs first, so the registry is empty until the
// new document registers.
wc.emit('did-navigate');
assert.equal(bgSignerBridge.getTransport(ID), null, 'teardown precedes re-registration: registry empty at commit');
await assert.rejects(inflightA, /signer bridge disconnected/, 'in-flight request of the old document rejects');

// A request through the stale transport must not reach the new document.
register();
const newTransport = bgSignerBridge.getTransport(ID);
assert.equal(typeof newTransport, 'function', 'document B re-registered');
assert.notEqual(newTransport, oldTransport, 'registry serves a fresh transport, not the old one');
await assert.rejects(oldTransport(req), /disconnected/, 'stale transport stays dead after re-registration');
assert.equal(wc.sent.length, sentBeforeReload, 'nothing from the stale transport reached the renderer');

// Document B round-trips.
const inflightB = newTransport(req);
const frame = wc.sent.at(-1).msg;
assert.equal(frame.kind, 'request');
ipc.emit({ sender: wc }, { kind: 'response', reqId: frame.reqId, ok: true, result: 'signed-b' });
assert.equal(await inflightB, 'signed-b', 'document B request resolves');

// Hooks do not accumulate across reloads.
for (const ev of ['destroyed', 'did-navigate', 'render-process-gone']) {
    assert.equal(wc.count(ev), 1, `exactly one ${ev} hook after a reload`);
}

// Back-to-back reloads: each tears down the entry it belongs to.
wc.emit('did-navigate');
wc.emit('did-navigate');
assert.equal(bgSignerBridge.getTransport(ID), null, 'repeat reload events leave the registry empty');
register();
assert.equal(typeof bgSignerBridge.getTransport(ID), 'function', 'registration after repeated reloads works');

// A different window's registration of the same id is refused while this one
// is live, and is accepted right after this one reloads.
const other = createFakeWebContents(8);
ipc.emit({ sender: other }, { kind: 'register', signerIds: [ID] });
const heldByWc = bgSignerBridge.getTransport(ID);
ipc.emit({ sender: other }, { kind: 'register', signerIds: [ID] });
assert.equal(bgSignerBridge.getTransport(ID), heldByWc, 'a live owner keeps its id against another window');
wc.emit('did-navigate');
ipc.emit({ sender: other }, { kind: 'register', signerIds: [ID] });
assert.notEqual(bgSignerBridge.getTransport(ID), heldByWc, 'after the owner reloads another window may take the id');

detach();
bgSignerBridge.clearAll();

// index.js wiring: the listener is attached before the first window opens.
const indexSrc = readFileSync(
    fileURLToPath(new URL('../../../packages/desktop/main/index.js', import.meta.url)), 'utf8');
const attachAt = indexSrc.indexOf('attachSignerBridgeListener({');
const firstWindowAt = indexSrc.lastIndexOf('createWindow();');
assert.ok(attachAt > 0, 'index.js attaches the signer bridge listener');
assert.ok(attachAt < firstWindowAt, 'the listener is attached before the first window is created');

console.log('OK: desktop HW reload ordering smoke (teardown before re-register, stale transport dead, no hook pile-up, cross-window ownership after reload, attach precedes first window)');
