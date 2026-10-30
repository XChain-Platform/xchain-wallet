// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A dApp call that finds no host (locked, or a restarted worker still
// rebuilding) is answered by the boot gate. Before it, such a call reached no
// listener, Chrome closed the port, and the page read INTERNAL_ERROR with
// Chrome's own "message port closed" text instead of the published
// WALLET_LOCKED code.

import { describe, it, expect, vi } from 'vitest';
import { attachBridgeBootGate, WALLET_LOCKED_ENVELOPE } from '../../../packages/extension/src/background/bridgeBootGate.js';

const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';
const PAGE_SENDER = { origin: 'https://dapp.test', url: 'https://dapp.test/', tab: { id: 7 } };
const UI_SENDER = { origin: `chrome-extension://${EXT_ID}`, url: `chrome-extension://${EXT_ID}/popup.html` };

function setup({ hasHost = false, ensureHost = async () => null, dispatch = vi.fn() } = {}) {
    const listeners = new Set();
    const runtime = {
        id: EXT_ID,
        onMessage: {
            addListener: (fn) => listeners.add(fn),
            removeListener: (fn) => listeners.delete(fn),
        },
    };
    const detach = attachBridgeBootGate({
        runtime,
        hasHost: () => hasHost,
        ensureHost,
        dispatch,
    });
    const [listener] = [...listeners];
    const receive = (message, sender) => new Promise((resolve) => {
        const sendResponse = vi.fn(resolve);
        const keepOpen = listener(message, sender, sendResponse);
        if (keepOpen !== true) resolve({ declined: true, sendResponse });
    });
    return { listeners, detach, receive, dispatch };
}

describe('bridge boot gate', () => {
    it('answers WALLET_LOCKED to a page call when no session exists', async () => {
        const gate = setup({ ensureHost: async () => null });

        const response = await gate.receive({ type: 'bridge.getAccounts', request: {} }, PAGE_SENDER);

        expect(response).toEqual(WALLET_LOCKED_ENVELOPE);
        expect(response.error.code).toBe('WALLET_LOCKED');
        expect(gate.dispatch).not.toHaveBeenCalled();
    });

    it('holds a page call through a host rebuild and hands it to the host listener', async () => {
        let finishBuild;
        const built = new Promise((resolve) => { finishBuild = resolve; });
        const dispatch = vi.fn((_message, _sender, sendResponse) => sendResponse({ ok: true, result: [] }));
        const gate = setup({ ensureHost: () => built, dispatch });

        const pending = gate.receive({ type: 'bridge.getAccounts', request: {} }, PAGE_SENDER);
        expect(dispatch).not.toHaveBeenCalled();
        finishBuild({ handle: () => {} });

        await expect(pending).resolves.toEqual({ ok: true, result: [] });
        expect(dispatch).toHaveBeenCalledTimes(1);
    });

    it('stays out of the way while a host exists', async () => {
        const ensureHost = vi.fn(async () => null);
        const gate = setup({ hasHost: true, ensureHost });

        const outcome = await gate.receive({ type: 'bridge.getAccounts', request: {} }, PAGE_SENDER);

        expect(outcome.declined).toBe(true);
        expect(ensureHost).not.toHaveBeenCalled();
    });

    it('leaves trusted extension pages and non-bridge types to the other listeners', async () => {
        const ensureHost = vi.fn(async () => null);
        const gate = setup({ ensureHost });

        const fromUi = await gate.receive({ type: 'bridge.getAccounts', request: {} }, UI_SENDER);
        const privileged = await gate.receive({ type: 'action.send', request: {} }, PAGE_SENDER);

        expect(fromUi.declined).toBe(true);
        expect(privileged.declined).toBe(true);
        expect(ensureHost).not.toHaveBeenCalled();
    });

    it('answers INTERNAL_ERROR when the host build throws', async () => {
        const gate = setup({ ensureHost: async () => { throw new Error('vault open failed'); } });

        const response = await gate.receive({ type: 'bridge.connect', request: {} }, PAGE_SENDER);

        expect(response.ok).toBe(false);
        expect(response.error.code).toBe('INTERNAL_ERROR');
    });

    it('detaches its listener', () => {
        const gate = setup();
        expect(gate.listeners.size).toBe(1);
        gate.detach();
        expect(gate.listeners.size).toBe(0);
    });
});
