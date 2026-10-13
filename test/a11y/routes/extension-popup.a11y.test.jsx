// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterAll, afterEach, beforeAll, beforeEach, describe, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';
import { Receive } from '../../../packages/core/src/shared/routes/Receive.jsx';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { Router } from '../../../packages/extension/src/approval/Router.jsx';
import { expectNoSeriousAxeViolations } from '../helpers/axe.js';

vi.mock('qrcode', () => ({
    default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,iVBORw0KGgo=') },
}));

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const WALLET = { id: 'wallet-1', name: 'Primary', createdAt: '2026-01-01T00:00:00Z' };
const ACCOUNT = { id: 'account-1', walletId: WALLET.id, name: 'Main', index: 0 };
const SETTINGS = {
    ...createDefaultSettings(),
    fees: { [CHAIN]: {} },
};

function pending() {
    return new Promise(() => {});
}

function popupMessaging(overrides = {}) {
    const base = {
        getSettings: vi.fn().mockResolvedValue(SETTINGS),
        updateSettings: vi.fn().mockResolvedValue(SETTINGS),
        listWallets: vi.fn().mockResolvedValue([WALLET]),
        listAccounts: vi.fn().mockResolvedValue([ACCOUNT]),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                address: ADDRESS,
                native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                tokens: [],
            }],
        }),
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                id: 'address-1',
                address: ADDRESS,
                addressType: 'p2wpkh',
                derivationPath: "m/84'/0'/0'/0/0",
                source: 'hd',
            }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({
            [CHAIN]: { id: 'address-1', address: ADDRESS },
        }),
        getNewestAddress: vi.fn().mockResolvedValue({
            id: 'address-1',
            address: ADDRESS,
            addressType: 'p2wpkh',
            derivationPath: "m/84'/0'/0'/0/0",
            source: 'hd',
        }),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [],
        }),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        listContacts: vi.fn().mockResolvedValue([]),
        listConfirmSessions: vi.fn().mockResolvedValue({ sessions: [] }),
        listPendingAirdropsForWallet: vi.fn().mockResolvedValue([]),
        getMultisigReceiveAddress: vi.fn().mockResolvedValue(null),
        getCoinpayObligationsForAddress: vi.fn().mockResolvedValue([]),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        ...overrides,
    };
    return new Proxy(base, {
        get(target, property) {
            if (property in target) return target[property];
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn(pending);
            target[property] = stub;
            return stub;
        },
    });
}

function renderPopup(node, messaging = popupMessaging()) {
    return render(
        <MessagingProvider shell="popup" messaging={messaging}>
            <ToastHost>{node}</ToastHost>
        </MessagingProvider>,
    );
}

function mockChromeApproval() {
    const request = {
        id: 'approval-1',
        kind: 'connect',
        payload: {
            origin: 'https://app.example.test',
            appName: 'Example app',
            requestedChains: [CHAIN],
            accountOptions: [{ id: ACCOUNT.id, name: ACCOUNT.name }],
        },
    };
    return {
        runtime: {
            lastError: null,
            sendMessage(message, callback) {
                const result = message.type === 'approval.fetch'
                    ? request
                    : message.type === 'settings.get'
                        ? SETTINGS
                        : {};
                callback({ ok: true, result });
            },
        },
        extension: { getViews: vi.fn().mockReturnValue([window]) },
        storage: {
            local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
            session: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
            onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
        },
    };
}

let originalResizeObserver;
let originalWidth;
let originalHeight;

beforeAll(() => {
    originalResizeObserver = globalThis.ResizeObserver;
    originalWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    originalHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
    globalThis.ResizeObserver = class ResizeObserver {
        observe() {}
        disconnect() {}
    };
});

beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    document.documentElement.style.width = '360px';
    document.documentElement.style.height = '600px';
    window.history.replaceState(null, '', '/popup.html');
    vi.stubGlobal('chrome', mockChromeApproval());
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    document.documentElement.removeAttribute('style');
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe('extension popup main-screen accessibility', () => {
    it('scans the locked screen at popup size', async () => {
        const { container } = renderPopup(<Locked onUnlocked={() => {}} />);
        await screen.findByLabelText('Password');
        await expectNoSeriousAxeViolations(container);
    });

    it('scans the loaded Home screen at popup size', async () => {
        const { container } = renderPopup(
            <Home
                activeWalletId={WALLET.id}
                activeAccountId={ACCOUNT.id}
                onSend={() => {}}
                onReceive={() => {}}
                onOpenSettings={() => {}}
                onLockWallet={() => {}}
            />,
        );
        await screen.findByRole('region', { name: 'Active address balance' });
        await expectNoSeriousAxeViolations(container);
    });

    it('scans the loaded Send screen at popup size', async () => {
        const { container } = renderPopup(
            <Send walletId={WALLET.id} accountId={ACCOUNT.id} onBack={() => {}} />,
        );
        await screen.findByLabelText('To');
        await expectNoSeriousAxeViolations(container);
    });

    it('scans the loaded Receive screen at popup size', async () => {
        const { container } = renderPopup(
            <Receive walletId={WALLET.id} accountId={ACCOUNT.id} onBack={() => {}} />,
        );
        await screen.findByRole('textbox', { name: 'Copy payment link for receive address' });
        await expectNoSeriousAxeViolations(container);
    });

    it('scans a Chrome-delivered approval request at popup size', async () => {
        window.history.replaceState(null, '', '/approval.html?id=approval-1');
        const { container } = render(<Router />);
        await screen.findByText('Connect to XChain Wallet?');
        await screen.findByLabelText('Share Main');
        await expectNoSeriousAxeViolations(container);
    });
});

afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    if (originalWidth) Object.defineProperty(window, 'innerWidth', originalWidth);
    if (originalHeight) Object.defineProperty(window, 'innerHeight', originalHeight);
});
