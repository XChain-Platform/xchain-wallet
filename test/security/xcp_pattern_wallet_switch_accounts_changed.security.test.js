// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it } from 'vitest';
import { createConnectedTabRegistry } from '../../packages/extension/src/background/connectedTabs.js';
import { createBridgeEventBroadcaster } from '../../packages/extension/src/bridge/bridgeEvents.js';

function fakeRuntime(accountByWallet, sites) {
    let listener = null;
    return {
        id: 'wallet-extension',
        getURL: (path) => `chrome-extension://wallet-extension/${path}`,
        onMessage: { addListener(fn) { listener = fn; } },
        sendMessage(message, callback) {
            const result = message.type === 'account.list'
                ? accountByWallet[message.request.walletId]
                : sites;
            callback({ ok: true, result });
        },
        select(walletId, senderId = 'wallet-extension') {
            return listener(
                { type: 'account.list', request: { walletId } },
                { id: senderId, url: 'chrome-extension://wallet-extension/popup.html' },
            );
        },
    };
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

describe('wallet switch bridge notification', () => {
    it('sends each connected site only the new wallet accounts it was granted', async () => {
        const registry = createConnectedTabRegistry({ sessionArea: null });
        registry.record(7, 'https://partial.example');
        registry.record(8, 'https://other-wallet.example');
        registry.record(9, 'https://wildcard.example');
        registry.record(10, 'https://stale.example');
        const runtime = fakeRuntime(WALLETS, [
            { origin: 'https://partial.example', permissions: { accounts: ['account-first', 'second-a'] } },
            { origin: 'https://other-wallet.example', permissions: { accounts: ['account-first'] } },
            { origin: 'https://wildcard.example', permissions: { accounts: [] } },
        ]);
        const sends = [];
        const wildcardDelivered = new Promise((resolve) => {
            createBridgeEventBroadcaster({
                runtime,
                connectedTabs: registry,
                tabs: fakeTabs((send) => {
                    sends.push(send);
                    if (send.tabId === 9) resolve();
                }),
            });
        });

        expect(runtime.select('first')).toBe(false);
        expect(runtime.select('second')).toBe(false);
        await wildcardDelivered;
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(sends).toEqual([
            accountsChangedTo(7, 'https://partial.example', [{ id: 'second-a', name: 'Second A' }]),
            accountsChangedTo(9, 'https://wildcard.example', WALLETS.second),
        ]);
    });

    it('sends nothing when the account lookup gets no answer', async () => {
        const registry = createConnectedTabRegistry({ sessionArea: null });
        registry.record(9, 'https://wildcard.example');
        const runtime = fakeRuntime(WALLETS, [
            { origin: 'https://wildcard.example', permissions: { accounts: [] } },
        ]);
        const lookups = [];
        runtime.sendMessage = (message, callback) => {
            lookups.push(message.type);
            callback(undefined);
        };
        const sends = [];
        createBridgeEventBroadcaster({
            runtime,
            connectedTabs: registry,
            tabs: fakeTabs((send) => sends.push(send)),
        });

        expect(runtime.select('first')).toBe(false);
        expect(runtime.select('second')).toBe(false);
        // The switch handler runs on promises alone, so one timer turn lets it reach its bail-out.
        await new Promise((resolve) => setTimeout(resolve, 0));
        // Prove the handler actually ran both lookups, so "nothing sent" is a real result.
        expect(lookups).toEqual(['account.list', 'sites.list']);
        expect(sends).toEqual([]);
    });
});
