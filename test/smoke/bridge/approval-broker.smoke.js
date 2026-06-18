// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke test for Batch 3 piece 8 (approval window plumbing).
//
// Exercises the full broker lifecycle against a fake chrome.windows:
//
//   1. connect()           opens a window, parks a request, returns a
//                          pending promise, exposes the request via
//                          `fetch(id)`.
//   2. resolve(id, result) settles the pending promise, closes the
//                          window. Subsequent fetch/resolve for the
//                          same id are no-ops.
//   3. window-close        a user closing the popup without deciding
//                          resolves the parked promise as
//                          `{ approved: false }`: the bridge's
//                          USER_REJECTED convention.
//
// Also drives the `approval.fetch` + `approval.resolve` host handlers
// through a real MessageHost so the popup → background IPC is covered.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

import {
    registry as registryLib,
    sdk as sdkLib,
    storage as storageLib,
} from '../../../packages/core/src/index.js';
import { ApprovalBroker } from '../../../packages/extension/src/background/approvalBroker.js';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const ext = join(wsRoot, 'packages', 'extension');

// --- 1. Static surface ------------------------------------------------

const vite = readFileSync(join(ext, 'vite.config.js'), 'utf8');
assert.ok(/approval: fileURLToPath/.test(vite), 'vite declares approval entry');
for (const rel of ['approval.html', 'src/approval/main.jsx', 'src/approval/messaging.js']) {
    readFileSync(join(ext, rel), 'utf8');
}
const approvalHtml = readFileSync(join(ext, 'approval.html'), 'utf8');
assert.ok(
    approvalHtml.includes('id="xchain-approval-root"'),
    'approval.html has root div',
);
assert.ok(
    approvalHtml.includes('src/approval/main.jsx'),
    'approval.html references main.jsx',
);

const approvalMsg = readFileSync(
    join(ext, 'src', 'approval', 'messaging.js'),
    'utf8',
);
for (const fn of ['fetchApproval', 'resolveApproval']) {
    assert.ok(
        new RegExp(`export function ${fn}\\b`).test(approvalMsg),
        `approval/messaging.js exports ${fn}`,
    );
}

const shared = readFileSync(
    join(ext, 'src', 'shared', 'chromeMessaging.js'),
    'utf8',
);
assert.ok(
    /export function sendMessage/.test(shared),
    'shared/chromeMessaging.js owns sendMessage',
);

const popupMsg = readFileSync(
    join(ext, 'src', 'popup', 'messaging.js'),
    'utf8',
);
assert.ok(
    popupMsg.includes("from '../../../packages/core/shared/chromeMessaging.js'"),
    'popup/messaging.js re-imports from shared',
);

const bg = readFileSync(join(ext, 'src', 'background.js'), 'utf8');
assert.ok(
    bg.includes('new ApprovalBroker'),
    'background.js constructs ApprovalBroker at module scope',
);
assert.ok(
    bg.includes('approvals: approvalBroker'),
    'background.js passes broker as approvals dep to host',
);

const bgHost = readFileSync(
    join(ext, 'src', 'background', 'createBackgroundHost.js'),
    'utf8',
);
assert.ok(
    /host\.register\('approval\.fetch'/.test(bgHost),
    'host registers approval.fetch',
);
assert.ok(
    /host\.register\('approval\.resolve'/.test(bgHost),
    'host registers approval.resolve',
);

// --- 2. Fake chrome.windows harness ----------------------------------

function makeFakeWindows() {
    let nextId = 100;
    /** @type {Array<{ id: number, options: any }>} */
    const open = [];
    /** @type {Array<(id: number) => void>} */
    const removedListeners = [];
    return {
        _opened: () => open.slice(),
        _fireRemoved(id) {
            for (const fn of removedListeners) fn(id);
        },
        surface: {
            async create(options) {
                const id = nextId++;
                open.push({ id, options });
                return { id };
            },
            async remove(id) {
                const i = open.findIndex((w) => w.id === id);
                if (i >= 0) open.splice(i, 1);
            },
            onRemoved: {
                addListener(fn) { removedListeners.push(fn); },
                removeListener(fn) {
                    const i = removedListeners.indexOf(fn);
                    if (i >= 0) removedListeners.splice(i, 1);
                },
            },
        },
    };
}

function makeBroker(fakeWindows, overrides = {}) {
    return new ApprovalBroker({
        newId: overrides.newId ?? (() => 'req-fixed'),
        getUrl: (path) => `chrome-extension://testid/${path}`,
        windows: fakeWindows.surface,
        ...overrides,
    });
}

// --- 3. Lifecycle ----------------------------------------------------

// 3a. connect → fetch → resolve(approved:true)
{
    const fw = makeFakeWindows();
    const broker = makeBroker(fw);
    const pending = broker.connect({
        origin: 'https://app.example',
        appName: 'Example',
    });
    // Flush microtasks so the open-window .then fires.
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(fw._opened().length, 1, 'window opened');
    assert.ok(
        fw._opened()[0].options.url.includes('req-fixed'),
        'window URL carries the request id',
    );

    const fetched = broker.fetch('req-fixed');
    assert.equal(fetched.kind, 'connect');
    assert.equal(fetched.payload.origin, 'https://app.example');

    const ok = await broker.resolve('req-fixed', {
        approved: true,
        chains: ['bitcoin-mainnet'],
        accounts: ['acc-1'],
    });
    assert.equal(ok, true);
    const result = await pending;
    assert.equal(result.approved, true);
    assert.deepEqual(result.chains, ['bitcoin-mainnet']);
    // Window was closed on resolve.
    assert.equal(fw._opened().length, 0, 'window closed on resolve');
    assert.equal(broker._pendingSize(), 0, 'pending map drained');
}

// 3b. Second resolve for the same id is a no-op.
{
    const fw = makeFakeWindows();
    const broker = makeBroker(fw, { newId: () => 'again' });
    broker.signMessage({ origin: 'x', kind: 'signMessage' });
    await Promise.resolve();
    await Promise.resolve();
    await broker.resolve('again', { approved: false });
    const second = await broker.resolve('again', { approved: true });
    assert.equal(second, false, 'second resolve returns false');
}

// 3c. Unknown id: fetch returns null, resolve returns false.
{
    const fw = makeFakeWindows();
    const broker = makeBroker(fw);
    assert.equal(broker.fetch('ghost'), null);
    assert.equal(await broker.resolve('ghost', { approved: true }), false);
}

// 3d. User closes window → promise resolves as rejected.
{
    const fw = makeFakeWindows();
    const broker = makeBroker(fw, { newId: () => 'closeit' });
    const pending = broker.signPsbt({ origin: 'x', kind: 'signPsbt' });
    await Promise.resolve();
    await Promise.resolve();
    const windowId = fw._opened()[0].id;
    fw._fireRemoved(windowId);
    const result = await pending;
    assert.deepEqual(result, { approved: false }, 'window close → rejected');
    assert.equal(broker._pendingSize(), 0, 'pending cleared on close');
}

// 3e. No chrome.windows injected → promise rejects synchronously-ish.
{
    const broker = new ApprovalBroker({
        newId: () => 'orphan',
        getUrl: (p) => p,
        windows: undefined,
    });
    let caught = null;
    try {
        await broker.connect({ origin: 'x', appName: 'x' });
    } catch (err) {
        caught = err;
    }
    assert.ok(caught, 'missing windows rejects');
    assert.match(caught.message, /windows\.create unavailable/);
}

// --- 4. Host handler round-trip --------------------------------------

{
    const fw = makeFakeWindows();
    const broker = makeBroker(fw, { newId: () => 'host-1' });

    // Park a request.
    const pending = broker.connect({
        origin: 'https://dapp.example',
        appName: 'DApp',
    });
    await Promise.resolve();
    await Promise.resolve();

    // Build a real MessageHost with the broker wired in.
    const masterKey = new Uint8Array(32);
    crypto.getRandomValues(masterKey);
    const vault = new storageLib.Vault({
        backend: new storageLib.InMemoryBackend(),
        masterKey,
    });
    await vault.open();
    const chainRegistry = registryLib.defaultRegistry();
    const sdkRegistry = new sdkLib.SDKRegistry({
        chainRegistry,
        sdkFactory: () => ({ wallet: {}, auth: {} }),
    });
    const host = createBackgroundHost({
        vault,
        chainRegistry,
        sdkRegistry,
        approvals: broker,
    });

    // approval.fetch
    const fetchResp = await host.handle({
        type: 'approval.fetch',
        request: { id: 'host-1' },
    });
    assert.equal(fetchResp.ok, true);
    assert.equal(fetchResp.result.kind, 'connect');
    assert.equal(fetchResp.result.payload.origin, 'https://dapp.example');

    // approval.fetch with unknown id → structured error
    const missResp = await host.handle({
        type: 'approval.fetch',
        request: { id: 'nope' },
    });
    assert.equal(missResp.ok, false);
    assert.equal(missResp.error.name, 'ApprovalNotFoundError');

    // approval.resolve
    const resolveResp = await host.handle({
        type: 'approval.resolve',
        request: {
            id: 'host-1',
            result: { approved: true, chains: ['bitcoin-mainnet'] },
        },
    });
    assert.deepEqual(resolveResp, { ok: true, result: { resolved: true } });

    const pendingResult = await pending;
    assert.equal(pendingResult.approved, true);
}

console.log(
    'OK: approval broker smoke (static wiring + lifecycle + window-close + host IPC round-trip)',
);
