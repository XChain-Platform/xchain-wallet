// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, render } from '@testing-library/react';
import { computeAccessibleName } from 'dom-accessibility-api';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { clearDemoWalletId, markDemoWallet } from '../../../packages/core/src/flows/demoMode.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { AddressList } from '../../../packages/core/src/shared/routes/AddressList.jsx';
import { ContactsList } from '../../../packages/core/src/shared/routes/ContactsList.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';
import { Receive } from '../../../packages/core/src/shared/routes/Receive.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';
import { Settings } from '../../../packages/core/src/shared/routes/Settings.jsx';

vi.mock('lightweight-charts', () => ({
    createChart: () => ({
        addLineSeries: () => ({ setData() {}, applyOptions() {} }),
        timeScale: () => ({ fitContent() {} }),
        applyOptions() {},
        remove() {},
    }),
}));

vi.mock('qrcode', () => ({
    default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,iVBORw0KGgo=') },
}));

const WALLET = { id: 'demo-wallet', name: 'Demo Wallet', format: 'bip39' };
const ACCOUNT = { id: 'account-1', name: 'Daily', index: 0, walletId: WALLET.id };
const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const ADDRESS_RECORD = {
    id: 'address-1',
    address: ADDRESS,
    label: 'Primary address',
    addressType: 'p2wpkh',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    role: 'receive',
    accountId: ACCOUNT.id,
};
const SETTINGS = {
    ...createDefaultSettings(),
    activeNetwork: 'mainnet',
    fees: { [CHAIN]: { strategy: 'normal', rbfByDefault: true } },
};
const CONTACT = {
    schemaVersion: 1,
    id: 'contact-1',
    name: 'Alice',
    notes: 'Demo contact',
    entries: [{ chain: 'bitcoin', address: ADDRESS, label: 'Savings' }],
    avatarSeed: ADDRESS,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
};

const SETTINGS_SUBPAGES = [
    'this-wallet',
    'display',
    'keyboard',
    'privacy',
    'safety',
    'wallet-mode',
    'backup',
    'fees',
    'network-endpoints',
    'connected-sites',
    'ads',
    'developer',
    'about',
];

function pending() {
    return new Promise(() => {});
}

function createMessaging() {
    const methods = {
        listWallets: vi.fn().mockResolvedValue([WALLET]),
        listAccounts: vi.fn().mockResolvedValue([ACCOUNT]),
        getSettings: vi.fn().mockResolvedValue(SETTINGS),
        updateSettings: vi.fn().mockResolvedValue(SETTINGS),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS_RECORD] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: ADDRESS_RECORD }),
        getNewestAddress: vi.fn().mockResolvedValue(ADDRESS_RECORD),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                ...ADDRESS_RECORD,
                balances: {
                    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                    tokens: [],
                },
            }],
        }),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [],
        }),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        getAddressMempool: vi.fn().mockResolvedValue([]),
        getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
        getLinksForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
        getAddressUtxos: vi.fn().mockResolvedValue([]),
        getAddressPreferences: vi.fn().mockResolvedValue({}),
        getNativePricesRequest: vi.fn().mockResolvedValue({}),
        getMultisigReceiveAddress: vi.fn().mockResolvedValue(null),
        listMultisigReceiveAddresses: vi.fn().mockResolvedValue([]),
        listQueuedBroadcasts: vi.fn().mockResolvedValue([]),
        listConfirmSessions: vi.fn().mockResolvedValue([]),
        listPendingAirdropsForWallet: vi.fn().mockResolvedValue([]),
        listContacts: vi.fn().mockResolvedValue([CONTACT]),
        listConnectedSites: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        labelSyncStatusRequest: vi.fn().mockResolvedValue(null),
    };
    return new Proxy(methods, {
        get(target, property) {
            if (property in target) return target[property];
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn(pending);
            target[property] = stub;
            return stub;
        },
    });
}

function settingsRoute(initialSubpageId) {
    return (
        <Settings
            onBack={() => {}}
            activeWallet={WALLET}
            activeAccount={ACCOUNT}
            onOpenWalletPicker={() => {}}
            onOpenAccountPicker={() => {}}
            initialSubpageId={initialSubpageId}
        />
    );
}

const ROUTES = [
    ['Home', <Home activeWalletId={WALLET.id} activeAccountId={ACCOUNT.id} />],
    ['History', <History walletId={WALLET.id} accountId={ACCOUNT.id} onBack={() => {}} />],
    ['Send', <Send walletId={WALLET.id} accountId={ACCOUNT.id} onBack={() => {}} />],
    ['Receive', <Receive walletId={WALLET.id} accountId={ACCOUNT.id} onBack={() => {}} />],
    ['Settings', settingsRoute(null)],
    ...SETTINGS_SUBPAGES.map((id) => [`Settings/${id}`, settingsRoute(id)]),
    ['Contacts', <ContactsList walletId={WALLET.id} onBack={() => {}} />],
    ['Addresses', <AddressList walletId={WALLET.id} accountId={ACCOUNT.id} onBack={() => {}} />],
];

function invalidInteractiveElements(container) {
    return [...container.querySelectorAll('button, a, [role="button"], [role="link"]')]
        .filter((element) => {
            if (!computeAccessibleName(element).trim()) return true;
            const isIconOnly = !element.textContent.trim();
            return isIconOnly
                && !element.getAttribute('aria-label')?.trim()
                && !element.getAttribute('aria-labelledby')?.trim();
        })
        .map((element) => element.outerHTML);
}

async function flushLoadedControls() {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
}

let originalResizeObserver;
beforeAll(() => {
    originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class ResizeObserver {
        observe() {}
        disconnect() {}
    };
});

afterEach(() => {
    cleanup();
    clearDemoWalletId();
    vi.clearAllMocks();
});

afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
});

describe('demo main route accessible names', () => {
    it.each(ROUTES)('%s names every button and link', async (_name, route) => {
        markDemoWallet(WALLET.id);
        const messaging = createMessaging();
        const { container } = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <ToastHost>{route}</ToastHost>
            </MessagingProvider>,
        );

        await flushLoadedControls();

        expect(invalidInteractiveElements(container)).toEqual([]);
    });
});
