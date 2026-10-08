// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it } from 'vitest';
import { createConnectedTabRegistry } from '../../packages/extension/src/background/connectedTabs.js';
import { createBackgroundHost } from '../../packages/extension/src/background/createBackgroundHost.js';
import { createBridgeEventBroadcaster } from '../../packages/extension/src/bridge/bridgeEvents.js';
import { isMessageAllowedFromSender } from '../../packages/extension/src/bridge/publicSurface.js';

const EXTENSION_ID = 'wallet-extension';

// Chrome never hands a worker's own sendMessage back to it, so this runtime
// answers nothing and records every listener and self-send for the asserts.
function chromeLikeRuntime() {
    const listeners = [];
    const selfSends = [];
    return {
        id: EXTENSION_ID,
        getURL: (path) => `chrome-extension://${EXTENSION_ID}/${path}`,
        onMessage: { addListener(fn) { listeners.push(fn); } },
        sendMessage(message, callback) {
            selfSends.push(message?.type);
            if (typeof callback === 'function') callback(undefined);
        },
        listeners,
        selfSends,
    };
}

function fakeVault(sites) {
    const accounts = Object.entries(WALLETS).flatMap(([walletId, list]) => (
        list.map((account, index) => ({ ...account, walletId, index }))
    ));
    return {
        settings: { get: async () => ({}) },
        wallets: {
            list: async () => Object.keys(WALLETS).map((id) => ({ id, name: id })),
            get: async (id) => (WALLETS[id] ? { id, name: id } : null),
        },
        accounts: { findBy: async (field, value) => accounts.filter((a) => a[field] === value) },
        connectedSites: { list: async () => sites },
    };
}

function hostWith(bridgeEvents, sites) {
    return createBackgroundHost({
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents,
        getDiagnosticContext: () => ({}),
        vault: fakeVault(sites),
        chainRegistry: { get: () => null, list: () => [] },
        sdkRegistry: { for: () => ({}) },
    });
}

function extensionPage(path) {
    return { id: EXTENSION_ID, url: `chrome-extension://${EXTENSION_ID}/${path}` };
}

function fakeTabs(onSend) {
    return {
        sendMessage(tabId, message, callback) {
            onSend({ tabId, message });
            callback();
        },
    };
}

function accountsChangedTo(tabId, origin, payload) {
    return {
        tabId,
        message: { type: 'bridge.event', event: 'accountsChanged', payload, origin },
    };
}

const WALLETS = {
    first: [{ id: 'account-first', name: 'First' }],
    second: [
        { id: 'second-a', name: 'Second A' },
        { id: 'second-b', name: 'Second B' },
    ],
};

const SITES = [
    { origin: 'https://partial.example', permissions: { accounts: ['account-first', 'second-a'] } },
    { origin: 'https://other-wallet.example', permissions: { accounts: ['account-first'] } },
    { origin: 'https://wildcard.example', permissions: { accounts: [] } },
];

function connectedRegistry() {
    const registry = createConnectedTabRegistry({ sessionArea: null });
    registry.record(7, 'https://partial.example');
    registry.record(8, 'https://other-wallet.example');
    registry.record(9, 'https://wildcard.example');
    registry.record(10, 'https://stale.example');
    return registry;
}

function broadcasterFor(runtime, sends) {
    return createBridgeEventBroadcaster({
        runtime,
        connectedTabs: connectedRegistry(),
        tabs: fakeTabs((send) => sends.push(send)),
    });
}

describe('wallet switch bridge notification', () => {
    it('sends each connected site only the new wallet accounts it was granted', async () => {
        const runtime = chromeLikeRuntime();
        const sends = [];
        const host = hostWith(broadcasterFor(runtime, sends), SITES);

        const reply = await host.handle({ type: 'wallet.setActive', request: { walletId: 'second' } });

        expect(reply.ok).toBe(true);
        expect(sends).toEqual([
            accountsChangedTo(7, 'https://partial.example', [{ id: 'second-a', name: 'Second A' }]),
            accountsChangedTo(9, 'https://wildcard.example', WALLETS.second),
        ]);
        // The data came from the vault, not from the worker messaging itself.
        expect(runtime.selfSends).toEqual([]);
    });

    it('sends nothing when the account lookup gets no answer', async () => {
        const sends = [];
        const events = broadcasterFor(chromeLikeRuntime(), sends);

        await events.walletSwitched(undefined, SITES);
        await events.walletSwitched(WALLETS.second, null);
        expect(sends).toEqual([]);

        // Control: the same broadcaster does deliver once both lists are present.
        await events.walletSwitched(WALLETS.second, [SITES[2]]);
        expect(sends).toEqual([accountsChangedTo(9, 'https://wildcard.example', WALLETS.second)]);
    });

    it('adds no runtime message listener and never messages its own worker', async () => {
        const runtime = chromeLikeRuntime();
        const sends = [];
        broadcasterFor(runtime, sends);
        broadcasterFor(runtime, sends);

        // One listener per unlock used to pile up here and guess switches from lookups.
        expect(runtime.listeners).toEqual([]);
        expect(runtime.selfSends).toEqual([]);
    });

    it('treats an account lookup for another wallet as no switch', async () => {
        const sends = [];
        const host = hostWith(broadcasterFor(chromeLikeRuntime(), sends), SITES);

        const reply = await host.handle({ type: 'account.list', request: { walletId: 'second' } });

        expect(reply.ok).toBe(true);
        expect(sends).toEqual([]);
    });

    it('refuses a wallet id the vault does not hold and notifies no one', async () => {
        const sends = [];
        const host = hostWith(broadcasterFor(chromeLikeRuntime(), sends), SITES);

        const unknown = await host.handle({ type: 'wallet.setActive', request: { walletId: 'gone' } });
        const missing = await host.handle({ type: 'wallet.setActive', request: {} });

        expect(unknown.ok).toBe(false);
        expect(missing.ok).toBe(false);
        expect(sends).toEqual([]);
    });

    it('accepts wallet.setActive from every wallet page and refuses it from a web page', () => {
        for (const path of ['popup.html', 'sidepanel.html', 'popup.html?uri=x']) {
            expect(isMessageAllowedFromSender('wallet.setActive', extensionPage(path), EXTENSION_ID)).toBe(true);
        }
        const webPage = { id: EXTENSION_ID, url: 'https://evil.example/', origin: 'https://evil.example', tab: { id: 3 } };
        expect(isMessageAllowedFromSender('wallet.setActive', webPage, EXTENSION_ID)).toBe(false);
    });
});
