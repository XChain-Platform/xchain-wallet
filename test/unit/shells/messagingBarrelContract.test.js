// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The three messaging barrels are the wire between a shared route and its
// shell's host. Each is ~300 one-line helpers that name a host message and
// forward their argument, and until now nothing called any of them: the
// modules were never imported by a unit test, so a helper that named the
// wrong message, or forgot to forward its options, shipped unremarked. The
// routes under `@xchain-wallet/core/shared/routes/*` are compiled against
// these names in all three shells at once, so drift in one shell is a
// feature that is simply missing there.
//
// The expectation here is deliberately NOT read out of the module under
// test, which would only assert that the file equals itself. Each barrel is
// an independent implementation of the same contract, so the shells check
// each other: for every helper two or more of them export, they must name
// the same message and build the same payload from the same arguments.
// Helpers unique to one shell get the weaker, still-real check that they
// dispatch exactly once and carry their argument across.
//
// The transports are mocked, because what is under test is the envelope,
// not chrome.runtime or the in-page host.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { webSend, desktopSend, popupSend, webLocals } = vi.hoisted(() => {
    const webLocals = {
        getSessionStatus: vi.fn(),
        unlockWalletLocal: vi.fn(),
        lockWalletLocal: vi.fn(),
        createWalletLocal: vi.fn(),
        importMnemonicLocal: vi.fn(),
        importBackupLocal: vi.fn(),
    };
    return {
        webSend: vi.fn(),
        desktopSend: vi.fn(),
        popupSend: vi.fn(),
        webLocals,
    };
});

vi.mock('../../../packages/web/src/hostBridge.js', () => ({
    sendMessage: webSend,
    ...webLocals,
}));

vi.mock('../../../packages/desktop/renderer/bridgeMessaging.js', () => ({
    sendMessage: desktopSend,
}));

vi.mock('../../../packages/extension/src/shared/chromeMessaging.js', () => ({
    sendMessage: popupSend,
}));

const web = await import('../../../packages/web/src/messaging.js');
const desktop = await import('../../../packages/desktop/renderer/messaging.js');
const popup = await import('../../../packages/extension/src/popup/messaging.js');

const SHELLS = [
    { name: 'web', mod: web, send: webSend },
    { name: 'desktop', mod: desktop, send: desktopSend },
    { name: 'extension popup', mod: popup, send: popupSend },
];

// The transports themselves are re-exported by the barrels. They are the
// mock, not a helper, so calling one proves nothing about the barrel.
const TRANSPORT_RE_EXPORTS = new Set(['sendMessage', 'getSessionStatus']);

// The five web helpers that call an in-page host function directly instead
// of naming a message: the web shell IS the host, so `wallet.unlock` and its
// four siblings are function calls rather than envelopes. They are exercised
// here (that is what keeps a silently-removed call visible) but they have no
// message name to compare against the other shells.
const WEB_LOCAL_HELPERS = new Set([
    'unlockWallet', 'lockWallet', 'createWallet', 'importMnemonic', 'importBackupFresh',
]);

// One argument fixture, passed to every helper in every position. Carrying
// the keys the helpers actually destructure keeps two shells on the same
// branch of an optional-argument test, so a payload difference between them
// is drift rather than an artifact of the fixture.
const ARG = Object.freeze({
    walletId: 'w-1',
    accountId: 'a-1',
    addressId: 'addr-1',
    address: 'bcrt1qexample',
    chainId: 'BTC',
    password: 'correct horse battery staple',
    bip39Passphrase: 'the-25th-word',
    name: 'Cold',
    asset: 'XCHAIN',
    quantity: '1',
    id: 'id-1',
    limit: 10,
    offset: 0,
});

/**
 * Call one helper with the fixture in three positions and report the single
 * `sendMessage` envelope it produced, or how it declined to produce one.
 */
function dispatch(shell, fnName) {
    shell.send.mockReset();
    shell.send.mockReturnValue(Promise.resolve({ ok: true }));
    for (const local of Object.values(webLocals)) {
        local.mockReset();
        local.mockReturnValue(Promise.resolve({ ok: true }));
    }
    let threw = null;
    try {
        const out = shell.mod[fnName](ARG, ARG, ARG);
        // Swallow the settled sentinel; an unhandled rejection here would
        // fail an unrelated test file, not this one.
        if (out && typeof out.then === 'function') out.then(() => {}, () => {});
    } catch (err) {
        threw = err;
    }
    return {
        threw,
        calls: shell.send.mock.calls,
        localCalls: Object.values(webLocals).reduce((n, m) => n + m.mock.calls.length, 0),
    };
}

/** Every exported helper of a barrel, minus the re-exported transport. */
function helpersOf(shell) {
    return Object.keys(shell.mod)
        .filter((k) => typeof shell.mod[k] === 'function')
        .filter((k) => !TRANSPORT_RE_EXPORTS.has(k))
        .sort();
}

beforeEach(() => {
    webSend.mockReset();
    desktopSend.mockReset();
    popupSend.mockReset();
});

describe('messaging barrels: every helper dispatches exactly one envelope', () => {
    for (const shell of SHELLS) {
        it(`${shell.name} sends one message per helper and forwards its argument`, () => {
            const bad = [];
            for (const fnName of helpersOf(shell)) {
                const r = dispatch(shell, fnName);
                if (r.threw) {
                    bad.push(`${fnName}: threw ${r.threw.message}`);
                    continue;
                }
                // The web shell's five local helpers reach the host by
                // function call; everything else names a message.
                if (shell.name === 'web' && WEB_LOCAL_HELPERS.has(fnName)) {
                    if (r.localCalls !== 1) bad.push(`${fnName}: called the host ${r.localCalls} times, expected 1`);
                    continue;
                }
                if (r.calls.length !== 1) {
                    bad.push(`${fnName}: sent ${r.calls.length} messages, expected 1`);
                    continue;
                }
                const [type, payload] = r.calls[0];
                if (typeof type !== 'string' || !type.includes('.')) {
                    bad.push(`${fnName}: message type ${JSON.stringify(type)} is not a dotted name`);
                }
                // A helper that takes an argument and drops it on the floor
                // is the silent half of this bug class: the host receives a
                // well-named message with nothing in it.
                if (shell.mod[fnName].length > 0 && payload === undefined) {
                    bad.push(`${fnName}: takes an argument but sent no payload`);
                }
            }
            expect(bad).toEqual([]);
        });
    }
});

describe('messaging barrels: the shells agree on the wire', () => {
    // Built once: helper name -> { shellName -> [type, payload] }.
    const wire = new Map();
    for (const shell of SHELLS) {
        for (const fnName of helpersOf(shell)) {
            if (shell.name === 'web' && WEB_LOCAL_HELPERS.has(fnName)) continue;
            const r = dispatch(shell, fnName);
            if (r.threw || r.calls.length !== 1) continue;
            if (!wire.has(fnName)) wire.set(fnName, {});
            wire.get(fnName)[shell.name] = r.calls[0];
        }
    }

    const shared = [...wire.entries()].filter(([, byShell]) => Object.keys(byShell).length > 1);

    it('has helpers implemented by more than one shell', () => {
        // Guards the check below against passing because it compared nothing.
        expect(shared.length).toBeGreaterThan(100);
    });

    it('names the same host message in every shell that implements it', () => {
        const drift = [];
        for (const [fnName, byShell] of shared) {
            const types = Object.entries(byShell).map(([s, [type]]) => [s, type]);
            const first = types[0][1];
            if (types.some(([, t]) => t !== first)) {
                drift.push(`${fnName}: ${types.map(([s, t]) => `${s}=${t}`).join(', ')}`);
            }
        }
        expect(drift).toEqual([]);
    });

    it('builds the same payload from the same arguments in every shell', () => {
        const drift = [];
        for (const [fnName, byShell] of shared) {
            const payloads = Object.entries(byShell).map(([s, [, payload]]) => [s, payload]);
            const first = JSON.stringify(payloads[0][1] ?? null);
            if (payloads.some(([, p]) => JSON.stringify(p ?? null) !== first)) {
                drift.push(`${fnName}: ${payloads.map(([s, p]) => `${s}=${JSON.stringify(p ?? null)}`).join(', ')}`);
            }
        }
        expect(drift).toEqual([]);
    });

    it('carries §3.4 capturePassphrase in all three shells, on one message name', () => {
        const byShell = wire.get('capturePassphrase');
        expect(Object.keys(byShell || {}).sort()).toEqual(['desktop', 'extension popup', 'web']);
        for (const [type] of Object.values(byShell)) expect(type).toBe('wallet.passphrase.capture');
    });
});
