// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from '@testing-library/react';
import { registry as registryLib } from '@xchain-wallet/core';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { App } from '../../../packages/extension/src/popup/App.jsx';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { attachChromeRuntime } from '../../../packages/extension/src/background/ChromeRuntimeAdapter.js';

const CHAIN_ID = 'bitcoin-mainnet';
const WALLET_ID = 'wallet-1';
const ACCOUNT_ID = 'account-1';
const FROM = 'bc1qsendersendersendersendersendersendersa';
const TO = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function collection(initial = []) {
    const records = new Map(initial.map((record) => [record.id, clone(record)]));
    return {
        get: async (id) => clone(records.get(id) ?? null),
        put: async (record) => { records.set(record.id, clone(record)); },
        list: async () => clone([...records.values()]),
        delete: async (id) => records.delete(id),
        find: async (id) => clone(records.get(id) ?? null),
        findBy: async (field, value) => clone(
            [...records.values()].filter((record) => record[field] === value),
        ),
    };
}

function storageArea(onChanged, areaName) {
    const values = {};
    return {
        get(key, callback) {
            const keys = Array.isArray(key) ? key : [key];
            const result = Object.fromEntries(keys.map((name) => [name, clone(values[name])]));
            callback(result);
        },
        set(next, callback) {
            const changes = {};
            for (const [key, value] of Object.entries(next)) {
                changes[key] = { oldValue: clone(values[key]), newValue: clone(value) };
                values[key] = clone(value);
            }
            for (const listener of onChanged.listeners) listener(changes, areaName);
            callback?.();
        },
        remove(keys, callback) {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
            callback?.();
        },
    };
}

function chromeEvent() {
    const listeners = new Set();
    return {
        listeners,
        addListener: (listener) => listeners.add(listener),
        removeListener: (listener) => listeners.delete(listener),
    };
}

function makeChrome() {
    const messages = [];
    const onMessage = chromeEvent();
    const onChanged = chromeEvent();
    const runtime = {
        id: 'integration-wallet',
        lastError: undefined,
        onMessage,
        getURL: (path) => `chrome-extension://integration-wallet/${path}`,
        sendMessage(message, callback) {
            messages.push(clone(message));
            const sender = {
                id: runtime.id,
                url: runtime.getURL('popup.html'),
            };
            for (const listener of onMessage.listeners) {
                if (listener(message, sender, callback) === true) return;
            }
            callback(undefined);
        },
    };
    return {
        messages,
        runtime,
        storage: {
            onChanged,
            local: storageArea(onChanged, 'local'),
            session: storageArea(onChanged, 'session'),
        },
    };
}

function makeBackground(chrome) {
    const settings = {
        ...createDefaultSettings(),
        activeNetwork: 'mainnet',
        fees: { [CHAIN_ID]: {} },
        walletMode: 'watcher',
        verifyProofs: false,
        privacy: {
            ...createDefaultSettings().privacy,
            formDraftTtlMs: 0,
        },
    };
    const address = {
        id: 'address-1',
        accountId: ACCOUNT_ID,
        chain: 'bitcoin',
        network: 'mainnet',
        source: 'watch-only',
        addressType: 'p2wpkh',
        derivationPath: "m/84'/0'/0'/0/0",
        address: FROM,
        publicKey: `02${'11'.repeat(32)}`,
        label: 'Primary Bitcoin address',
        role: 'receive',
        hidden: false,
    };
    const vault = {
        wallets: collection([{
            id: WALLET_ID,
            name: 'Integration Wallet',
            schemaVersion: 1,
            format: 'bip39',
            origin: 'imported',
            importedKeys: [],
            multisigs: [],
            createdAt: '2026-10-13T00:00:00.000Z',
        }]),
        accounts: collection([{
            id: ACCOUNT_ID,
            walletId: WALLET_ID,
            index: 0,
            name: 'Main account',
            activeAddressByChainId: { [CHAIN_ID]: address.id },
            createdAt: '2026-10-13T00:00:00.000Z',
        }]),
        addresses: collection([address]),
        contacts: collection(),
        signers: collection(),
        settings: {
            get: async () => clone(settings),
            put: async (next) => Object.assign(settings, clone(next)),
        },
    };
    const sdk = {
        getBalances: vi.fn(async () => ({ data: [], total: 0 })),
        getAddress: vi.fn(async () => ({
            balances: { confirmed: '1.00000000', pending: '0.00000000' },
        })),
        getHistory: vi.fn(async () => []),
    };
    const chainRegistry = registryLib.defaultRegistry();
    const host = createBackgroundHost({
        vault,
        chainRegistry,
        sdkRegistry: { get: () => sdk },
        signerPool: { get: () => null, has: () => false },
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });

    let unlocked = false;
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!['session.status', 'wallet.unlock'].includes(message?.type)) return false;
        if (sender?.id !== chrome.runtime.id) return false;
        if (message.type === 'session.status') {
            sendResponse({
                ok: true,
                result: {
                    hasWallet: true,
                    hasSession: unlocked,
                    state: unlocked ? 'unlocked' : 'locked',
                },
            });
            return true;
        }
        if (message.request?.password !== 'correct password') {
            sendResponse({
                ok: false,
                error: { name: 'InvalidPasswordError', message: 'Invalid password.' },
            });
            return true;
        }
        unlocked = true;
        sendResponse({ ok: true, result: { unlocked: true, passphraseCapture: [] } });
        return true;
    });
    const detach = attachChromeRuntime(host, chrome.runtime);
    return { detach, host };
}

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
});

describe('extension popup with the background message router', () => {
    it('unlocks, loads Home, opens Receive, and reaches send review through chrome messaging', async () => {
        const chrome = makeChrome();
        vi.stubGlobal('chrome', chrome);
        const background = makeBackground(chrome);

        render(<App />);

        expect(await screen.findByRole('form', { name: 'Unlock wallet' })).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Password'), {
            target: { value: 'correct password' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Unlock Wallet' }));

        const quickActions = await screen.findByRole('group', { name: 'Quick actions' });
        expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
        expect(chrome.messages).toContainEqual({
            type: 'wallet.unlock',
            request: { password: 'correct password' },
        });
        expect(chrome.messages).toContainEqual({ type: 'wallet.list' });
        expect(chrome.messages).toContainEqual({
            type: 'balances.wallet',
            request: { walletId: WALLET_ID, accountId: ACCOUNT_ID },
        });

        fireEvent.click(within(quickActions).getByRole('button', { name: 'Receive' }));

        expect(await screen.findByRole('heading', { name: 'Receive' })).toBeInTheDocument();
        expect(await screen.findByText(FROM)).toBeInTheDocument();
        expect(chrome.messages).toContainEqual({
            type: 'addresses.newest',
            request: { walletId: WALLET_ID, chainId: CHAIN_ID, accountId: ACCOUNT_ID },
        });
        const addressType = screen.getByLabelText('Address type');
        fireEvent.change(addressType, { target: { value: 'p2pkh' } });
        expect(screen.queryByText(FROM)).not.toBeInTheDocument();
        fireEvent.change(addressType, { target: { value: 'p2wpkh' } });
        expect(await screen.findByText(FROM)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Back to home' }));
        const homeActions = await screen.findByRole('group', { name: 'Quick actions' });
        fireEvent.click(within(homeActions).getByRole('button', { name: 'Send' }));

        fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: TO } });
        fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: '0.01' } });
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));

        const review = await screen.findByRole('form', { name: 'Review payment' });
        expect(review).toHaveTextContent(`Send 0.01 BTC on Bitcoin to ${TO}`);
        expect(review).toHaveTextContent('Watch-only mode creates a transaction without signing or sending it');
        expect(chrome.messages).toContainEqual({
            type: 'addresses.byChain',
            request: { walletId: WALLET_ID, accountId: ACCOUNT_ID },
        });
        expect(chrome.messages).toContainEqual({
            type: 'balances.address',
            request: { chainId: CHAIN_ID, address: FROM },
        });
        expect(background.host.types()).toContain('action.send.psbt');

        await waitFor(() => {
            expect(chrome.messages.filter(({ type }) => type === 'session.status').length)
                .toBeGreaterThanOrEqual(2);
        });
        background.detach();
    });
});
