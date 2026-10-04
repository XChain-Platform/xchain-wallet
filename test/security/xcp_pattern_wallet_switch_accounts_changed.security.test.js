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

describe('wallet switch bridge notification', () => {
    it('emits accountsChanged with the new wallet accounts', async () => {
        const registry = createConnectedTabRegistry({ sessionArea: null });
        registry.record(7, 'https://connected.example');
        registry.record(8, 'https://stale.example');
        const runtime = fakeRuntime({
            first: [{ id: 'account-first', name: 'First' }],
            second: [{ id: 'account-second', name: 'Second' }],
        }, [{
            origin: 'https://connected.example',
            permissions: { accounts: ['account-first'] },
        }]);
        const delivered = new Promise((resolve) => {
            createBridgeEventBroadcaster({
                runtime,
                connectedTabs: registry,
                tabs: fakeTabs(resolve),
            });
        });

        expect(runtime.select('first')).toBe(false);
        expect(runtime.select('second')).toBe(false);
        await expect(delivered).resolves.toEqual({
            tabId: 7,
            message: {
                type: 'bridge.event',
                event: 'accountsChanged',
                payload: [{ id: 'account-second', name: 'Second' }],
                origin: 'https://connected.example',
            },
        });
    });
});
