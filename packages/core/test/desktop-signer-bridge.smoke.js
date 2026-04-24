// Runtime smoke for the desktop main-process signer-bridge listener
// (HW Sign follow-up slice 4 / §40.12 HW-on-desktop). Exercises
// `attachSignerBridgeListener` against a fake ipcMain + fake
// webContents — no Electron, no real processes. Proves:
//
//   - First ipc message from a webContents lazily creates a per-
//     sender PortLike + transport.
//   - `kind: 'register'` messages populate the background signerBridge
//     so `getTransport(signerId)` hits the new transport.
//   - The transport's postMessage reaches the webContents' `send`
//     (round-trip over ipc → webContents.send → back through ipc).
//   - `kind: 'unregister'` drops the transport from the registry.
//   - `webContents.destroyed` tears down any still-owned signerIds
//     and rejects in-flight sign requests with
//     `signer bridge disconnected`.
//   - A detach() returned from the listener fully clears state.

import { strict as assert } from 'node:assert';

import * as bgSignerBridge from
    '../../extension/src/background/signerBridge.js';
import { attachSignerBridgeListener } from
    '../../desktop/main/signerBridgeListener.js';

// --- Fakes ----------------------------------------------------------

function createFakeIpcMain() {
    /** @type {Map<string, Set<(event: any, msg: any) => void>>} */
    const channelListeners = new Map();
    return {
        on(channel, fn) {
            if (!channelListeners.has(channel)) channelListeners.set(channel, new Set());
            channelListeners.get(channel).add(fn);
        },
        off(channel, fn) {
            channelListeners.get(channel)?.delete(fn);
        },
        _emit(channel, event, msg) {
            const set = channelListeners.get(channel);
            if (!set) return;
            for (const fn of set) fn(event, msg);
        },
        _channels() { return Array.from(channelListeners.keys()); },
    };
}

function createFakeWebContents(id) {
    /** @type {Map<string, Set<(...args: any[]) => void>>} */
    const eventListeners = new Map();
    /** @type {Array<{ channel: string, msg: any }>} */
    const sent = [];
    let destroyed = false;
    const wc = {
        id,
        isDestroyed() { return destroyed; },
        send(channel, msg) { sent.push({ channel, msg }); },
        once(event, fn) {
            if (!eventListeners.has(event)) eventListeners.set(event, new Set());
            eventListeners.get(event).add(fn);
        },
        _sent: sent,
        _destroy() {
            if (destroyed) return;
            destroyed = true;
            for (const fn of eventListeners.get('destroyed') || []) {
                try { fn(); } catch { /* swallow */ }
            }
        },
    };
    return wc;
}

// Keep the global bgSignerBridge registry clean between cases since
// it's module-scoped per process.
function resetRegistry() { bgSignerBridge.clearAll(); }

// --- 1. Lazy per-sender entry + register populates registry --------

resetRegistry();
const ipc1 = createFakeIpcMain();
const detach1 = attachSignerBridgeListener({ ipcMain: ipc1 });
const wc1 = createFakeWebContents(101);

assert.equal(
    bgSignerBridge.getTransport('sig-desk-1'), null,
    'signerBridge starts empty for sig-desk-1',
);
ipc1._emit('xchain-wallet:signer-bridge', { sender: wc1 }, {
    kind: 'register', signerIds: ['sig-desk-1'],
});

const transport = bgSignerBridge.getTransport('sig-desk-1');
assert.equal(typeof transport, 'function',
    'register populates signerBridge with a transport for sig-desk-1');

// --- 2. Transport round-trip — background request reaches webContents

const pending = transport({ op: 'status', payload: { signerId: 'sig-desk-1' } });
// The sent queue should now hold a `request` frame.
const last = wc1._sent.at(-1);
assert.ok(last, 'transport posts to webContents.send');
assert.equal(last.channel, 'xchain-wallet:signer-bridge');
assert.equal(last.msg.kind, 'request');
assert.equal(last.msg.op, 'status');
assert.equal(last.msg.payload.signerId, 'sig-desk-1');

// Simulate the renderer responding via ipc.
ipc1._emit('xchain-wallet:signer-bridge', { sender: wc1 }, {
    kind: 'response', reqId: last.msg.reqId, ok: true, result: 'available',
});
assert.equal(await pending, 'available', 'transport resolves with renderer result');

// --- 3. Unregister drops the transport ---------------------------

ipc1._emit('xchain-wallet:signer-bridge', { sender: wc1 }, {
    kind: 'unregister', signerIds: ['sig-desk-1'],
});
assert.equal(
    bgSignerBridge.getTransport('sig-desk-1'), null,
    'unregister clears signerBridge for sig-desk-1',
);

// --- 4. Window destroy — rejects in-flight + clears registry -----

resetRegistry();
const ipc2 = createFakeIpcMain();
const detach2 = attachSignerBridgeListener({ ipcMain: ipc2 });
const wc2 = createFakeWebContents(202);
ipc2._emit('xchain-wallet:signer-bridge', { sender: wc2 }, {
    kind: 'register', signerIds: ['sig-destroy'],
});
const transport2 = bgSignerBridge.getTransport('sig-destroy');
assert.equal(typeof transport2, 'function', 'sig-destroy is registered');
const inflight = transport2({ op: 'signPsbt', payload: { signerId: 'sig-destroy' } });
// Destroy mid-flight — should reject the pending promise.
wc2._destroy();
await assert.rejects(inflight, /signer bridge disconnected/,
    'destroyed webContents rejects in-flight requests');
assert.equal(
    bgSignerBridge.getTransport('sig-destroy'), null,
    'destroyed webContents drops owned signerIds from registry',
);

detach2();

// --- 5. detach() clears residual state --------------------------

resetRegistry();
const ipc3 = createFakeIpcMain();
const detach3 = attachSignerBridgeListener({ ipcMain: ipc3 });
const wc3 = createFakeWebContents(303);
ipc3._emit('xchain-wallet:signer-bridge', { sender: wc3 }, {
    kind: 'register', signerIds: ['sig-detach-a', 'sig-detach-b'],
});
assert.ok(bgSignerBridge.getTransport('sig-detach-a'));
assert.ok(bgSignerBridge.getTransport('sig-detach-b'));
detach3();
assert.equal(bgSignerBridge.getTransport('sig-detach-a'), null,
    'detach() clears registered transports');
assert.equal(bgSignerBridge.getTransport('sig-detach-b'), null,
    'detach() clears registered transports');

// Clean up state from case 1 (we never detached).
detach1();
resetRegistry();

console.log(
    'OK — desktop signer bridge smoke (fake ipcMain + webContents round-trip: lazy per-sender entry, register populates signerBridge, transport postMessage reaches webContents.send, response correlator resolves, unregister clears registry, webContents destroy rejects in-flight with "signer bridge disconnected" + clears owned ids, detach() drops all state)',
);
