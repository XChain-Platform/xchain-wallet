// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Shell integration: the background message host (G164).
//
// `createBackgroundHost` is the single message-routing surface behind ALL
// THREE shells: the extension service worker (packages/extension/background.js),
// the web in-page host (packages/web/src/hostBridge.js) and the Electron main
// process (packages/desktop/main/messageHost.js). Every privileged operation the
// UI can ask for -- unlock, sign, broadcast, dApp connect -- arrives as a message
// here.
//
// Until this file, it was referenced by 85 smoke files and EXECUTED BY NONE of
// them: every one of those smokes reads its SOURCE TEXT and greps for strings.
// That is how two of them ended up asserting inside a fixed 2400-CHARACTER
// window of the file and "failing" when a comment pushed the code past the
// cutoff, while the invariant they guarded was perfectly intact. Source-scanning
// cannot tell you whether a route dispatches, and it rots on contact with a
// refactor.
//
// So this drives the real host object. It is transport-agnostic by design
// (`handle(message)` in, `{ok}`/`{ok:false,error}` out), which is exactly what
// makes it testable without a browser, a service worker, or Electron.

import { describe, it, expect } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';

/**
 * The host needs a vault, a chain registry and an SDK registry. Everything else
 * (the persistence adapters) is explicitly opted out: passing `null` selects the
 * in-memory path, which is what we want when asserting routing rather than
 * storage.
 */
function makeHost(overrides = {}) {
    return createBackgroundHost({
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        vault: {
            settings: { get: async () => ({}) },
            wallets: { list: async () => [{ id: 'w1', name: 'Main' }] },
        },
        chainRegistry: { get: () => null, list: () => [] },
        sdkRegistry: { for: () => ({}) },
        ...overrides,
    });
}

// A route disappearing is a feature silently vanishing from every shell at once,
// so the security-relevant ones are named explicitly. These are not a wishlist:
// each is a privileged operation or a trust boundary this codebase has already
// had a real bug in.
const CRITICAL_ROUTES = [
    // Vault lifecycle. (There is no `wallet.unlock`: the session is gated by
    // `wallet.checkPassword` plus the auto-lock timer, per "password only at
    // unlock".)
    'wallet.create',
    'wallet.import',
    'wallet.checkPassword',
    'session.autolock',
    // Signing paths. `action.coinpay.psbt` is the encode-only watcher route
    // added, when the air-gapped COINPAY build was found bypassing the
    // sign-time obligation check by going through the generic PSBT
    // builder. If it stops being registered, that hole reopens.
    'action.coinpay',
    'action.coinpay.hw',
    'action.coinpay.psbt',
    'psbt.parse',
    // dApp bridge: the per-origin trust boundary hardened.
    'bridge.connect',
    'bridge.getAccounts',
    'bridge.getAddresses',
    'bridge.signAction',
];

describe('background message host (all three shells)', () => {
    it('registers the full route table', () => {
        const host = makeHost();
        // Not pinned to an exact count: routes get added legitimately. The point
        // is that construction actually WIRES the table rather than silently
        // producing an empty host.
        expect(host.types().length).toBeGreaterThan(200);
    });

    it('registers every security-critical route', () => {
        const host = makeHost();
        const registered = new Set(host.types());
        const missing = CRITICAL_ROUTES.filter((route) => !registered.has(route));
        expect(missing, `route(s) no longer registered: ${missing.join(', ')}`).toEqual([]);
    });

    it('rejects an unknown message type instead of hanging or throwing', async () => {
        const host = makeHost();
        // A caller that can silently drop an unroutable message is a UI that
        // spins forever. The host must always answer.
        const res = await host.handle({ type: 'nope.not.a.route' });

        expect(res.ok).toBe(false);
        expect(res.error.name).toBe('UnknownMessageTypeError');
    });

    it('rejects a malformed message instead of throwing', async () => {
        const host = makeHost();

        for (const bad of [null, undefined, 'string', 42, {}, { type: '' }]) {
            const res = await host.handle(bad);
            expect(res.ok, `handle(${JSON.stringify(bad)}) should not succeed`).toBe(false);
            expect(res.error.name).toBe('InvalidMessageError');
        }
    });

    it('serializes a handler failure into an error response, never a rejection', async () => {
        // A throwing handler must not escape as an unhandled rejection: in the
        // extension that is the service worker dying, taking every other pending
        // message with it. The caller gets {ok:false} and the worker lives.
        const host = makeHost({
            vault: {
                settings: { get: async () => ({}) },
                wallets: { list: async () => { throw new Error('vault exploded'); } },
            },
        });

        const res = await host.handle({ type: 'wallet.list' });

        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/vault exploded/);
    });

    it('dispatches a route to its handler and returns the result', async () => {
        const host = makeHost();

        const res = await host.handle({ type: 'wallet.list' });

        expect(res.ok).toBe(true);
        expect(Array.isArray(res.result)).toBe(true);
        expect(res.result[0].id).toBe('w1');
    });

    // This suite runs with no `chrome` global, which is the desktop and web
    // condition exactly: `createConfirmActionSessionStorage()` returns null and
    // the §5.4 resume feature is present in the messaging surface and inert in
    // fact. An empty session list is then indistinguishable from an extension
    // that simply has no pending confirms, so the three routes say which it is.
    it('reports confirm-session support rather than answering an empty list', async () => {
        const host = makeHost();

        const list = await host.handle({ type: 'action.confirmSession.list' });
        expect(list.ok).toBe(true);
        expect(list.result.supported).toBe(false);
        expect(list.result.sessions).toEqual([]);

        const put = await host.handle({
            type: 'action.confirmSession.put',
            request: { id: 'confirm-1' },
        });
        expect(put.ok).toBe(true);
        expect(put.result).toEqual({ supported: false, stored: false });

        const cleared = await host.handle({
            type: 'action.confirmSession.clear',
            request: { id: 'confirm-1' },
        });
        expect(cleared.ok).toBe(true);
        expect(cleared.result).toEqual({ supported: false, cleared: false });
    });

    it('refuses to register the same route twice', () => {
        // Two shells (or a merge) quietly clobbering a privileged route with a
        // second handler is a trust-boundary bug, so the host fails loudly.
        const host = makeHost();

        expect(() => host.register('wallet.list', async () => 'shadowed')).toThrow(
            /already registered/i,
        );
    });
});
