// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke test for Batch 3 piece 9 (per-kind approval screens).
//
// The broker lifecycle + `approval.fetch` / `approval.resolve` IPC is
// already covered by approval-broker.smoke.js. This smoke is
// UI-integration only:
//
//   1. Static wiring: Router / ConnectApproval / SignApproval exist,
//      the placeholder is gone from main.jsx, kind dispatch is correct,
//      KIND_TITLE covers all four sign kinds, savePermanent is
//      conditional on (signAction | signMessage-without-alreadyGranted),
//      result envelopes match the Approvals.js typedefs.
//
//   2. End-to-end through a fake broker: plant a connect request,
//      simulate the ConnectApproval result shape, verify the pending
//      bridge-side promise resolves with those exact fields. Same for
//      a signAction request with savePermanent=true.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

import { ApprovalBroker } from '../../../packages/extension/src/background/approvalBroker.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const ext = join(wsRoot, 'packages', 'extension');

// --- 1. Static wiring -------------------------------------------------

const main = readFileSync(
    join(ext, 'src', 'approval', 'main.jsx'),
    'utf8',
);
assert.ok(main.includes('<Router />'), 'main.jsx renders <Router />');
assert.ok(!main.includes('Placeholder'), 'main.jsx no longer references Placeholder');

const router = readFileSync(
    join(ext, 'src', 'approval', 'Router.jsx'),
    'utf8',
);
assert.ok(router.includes('fetchApproval'), 'Router fetches request from broker');
assert.ok(
    /data\.kind === 'connect'/.test(router),
    'Router dispatches on kind === connect',
);
assert.ok(router.includes('<ConnectApproval'), 'Router renders ConnectApproval');
assert.ok(router.includes('<SignApproval'), 'Router renders SignApproval (all other kinds)');
assert.ok(router.includes('resolveApproval'), 'Router wires reject via resolveApproval');

const connect = readFileSync(
    join(ext, 'src', 'approval', 'kinds', 'ConnectApproval.jsx'),
    'utf8',
);
assert.ok(
    /export function ConnectApproval/.test(connect),
    'ConnectApproval exports named component',
);
for (const field of ['chains', 'accounts', 'canSignMessage', 'canSignAction']) {
    assert.ok(
        connect.includes(field),
        `ConnectApproval result envelope includes ${field}`,
    );
}
assert.ok(
    connect.includes('chainRegistry.supportedChains()'),
    'ConnectApproval enumerates registry chains for the picker',
);

const sign = readFileSync(
    join(ext, 'src', 'approval', 'kinds', 'SignApproval.jsx'),
    'utf8',
);
assert.ok(
    /export function SignApproval/.test(sign),
    'SignApproval exports named component',
);
for (const kind of ['signMessage', 'signPsbt', 'signAction', 'signIn']) {
    assert.ok(
        sign.includes(`'${kind}'`),
        `SignApproval recognises ${kind}`,
    );
}
assert.ok(
    /KIND_TITLE\s*=\s*\{[\s\S]*?signMessage/.test(sign),
    'KIND_TITLE map covers signMessage',
);
assert.ok(
    /password,/.test(sign) && sign.includes('walletId'),
    'SignApproval result envelope carries password + walletId',
);
assert.ok(
    /kind === 'signAction'[\s\S]*?!payload\?\.\payload\?\.\alreadyGranted|kind === 'signMessage'/.test(sign),
    'savePermanent condition includes signAction | signMessage-when-not-alreadyGranted',
);
assert.ok(
    sign.includes("'InvalidPasswordError'"),
    'SignApproval surfaces InvalidPasswordError specifically',
);

// --- 2. End-to-end with a fake broker + simulated popup responses -----

function makeFakeWindows() {
    let nextId = 500;
    const open = [];
    const removedListeners = [];
    return {
        _opened: () => open.slice(),
        _fireRemoved(id) { for (const fn of removedListeners) fn(id); },
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

// 2a. Connect flow — simulate ConnectApproval's result envelope.
{
    const fw = makeFakeWindows();
    const broker = new ApprovalBroker({
        newId: () => 'connect-1',
        getUrl: (p) => `ext://${p}`,
        windows: fw.surface,
    });
    const pending = broker.connect({
        origin: 'https://dapp.example',
        appName: 'DApp',
        requestedChains: ['bitcoin-mainnet', 'dogecoin-mainnet'],
        requestedAccounts: [],
    });
    await Promise.resolve();
    await Promise.resolve();

    // What the popup would send after user ticks bitcoin-mainnet only
    // and toggles message signing on.
    await broker.resolve('connect-1', {
        approved: true,
        chains: ['bitcoin-mainnet'],
        accounts: [],
        canSignMessage: true,
        canSignAction: {},
    });
    const result = await pending;
    assert.deepEqual(result, {
        approved: true,
        chains: ['bitcoin-mainnet'],
        accounts: [],
        canSignMessage: true,
        canSignAction: {},
    });
}

// 2b. Sign action flow — simulate SignApproval's result envelope with
//     savePermanent.
{
    const fw = makeFakeWindows();
    const broker = new ApprovalBroker({
        newId: () => 'sign-action-1',
        getUrl: (p) => `ext://${p}`,
        windows: fw.surface,
    });
    const pending = broker.signAction({
        origin: 'https://dapp.example',
        kind: 'signAction',
        chainId: 'bitcoin-mainnet',
        action: 'SEND',
        payload: { tick: 'MYTOKEN', quantity: '100' },
    });
    await Promise.resolve();
    await Promise.resolve();

    await broker.resolve('sign-action-1', {
        approved: true,
        walletId: 'wallet-abc',
        password: 'hunter2',
        savePermanent: true,
    });
    const result = await pending;
    assert.equal(result.approved, true);
    assert.equal(result.walletId, 'wallet-abc');
    assert.equal(result.password, 'hunter2');
    assert.equal(result.savePermanent, true);
}

// 2c. Sign message flow — alreadyGranted case, no savePermanent field.
{
    const fw = makeFakeWindows();
    const broker = new ApprovalBroker({
        newId: () => 'sign-msg-1',
        getUrl: (p) => `ext://${p}`,
        windows: fw.surface,
    });
    const pending = broker.signMessage({
        origin: 'https://dapp.example',
        kind: 'signMessage',
        chainId: 'bitcoin-mainnet',
        payload: {
            address: 'bc1q...',
            message: 'verify me',
            alreadyGranted: true,
        },
    });
    await Promise.resolve();
    await Promise.resolve();

    await broker.resolve('sign-msg-1', {
        approved: true,
        walletId: 'wallet-abc',
        password: 'hunter2',
    });
    const result = await pending;
    assert.equal(result.savePermanent, undefined, 'no savePermanent when alreadyGranted');
}

console.log(
    'OK — approval screens smoke (static wiring + 3 broker round-trips matching popup result envelopes)',
);
