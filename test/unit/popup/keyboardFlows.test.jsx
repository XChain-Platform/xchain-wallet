// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { HomeTabs } from '../../../packages/core/src/shared/components/HomeTabs.jsx';
import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import { Receive } from '../../../packages/core/src/shared/routes/Receive.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';
import {
    clearDemoWalletId,
    clearLockoutState,
    setBiometricProvider,
} from '../../../packages/core/src/flows/index.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';
import { Router } from '../../../packages/extension/src/approval/Router.jsx';
import { unlockWallet } from '../../../packages/extension/src/popup/messaging.js';
import { userEvent } from '../../helpers/userEvent.js';

const CHAIN_ID = 'bitcoin-mainnet';
const WALLET_ID = 'keyboard-wallet';
const FROM = 'bc1qsendersendersendersendersendersendersa';
const TO = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

let chromeHandler;
let closeSpy;

function installChromeMock(handler = async () => null) {
    chromeHandler = handler;
    vi.stubGlobal('chrome', {
        runtime: {
            sendMessage: vi.fn((message, callback) => {
                Promise.resolve(chromeHandler(message)).then(
                    (result) => callback({ ok: true, result }),
                    (error) => callback({
                        ok: false,
                        error: { name: error?.name || 'Error', message: error?.message || String(error) },
                    }),
                );
            }),
        },
    });
}

function popupProvider(children, messaging) {
    return (
        <MessagingProvider shell="popup" messaging={messaging}>
            <ToastHost>{children}</ToastHost>
        </MessagingProvider>
    );
}

function routeMessaging(overrides = {}) {
    const base = {
        getSettings: vi.fn().mockResolvedValue({
            activeNetwork: 'mainnet',
            walletMode: 'full',
            grace: { testSendThresholdSats: 0 },
            privacy: { formDraftTtlMs: 0, priceDataEnabled: false },
        }),
        updateSettings: vi.fn().mockResolvedValue({}),
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN_ID]: [{
                id: 'address-1',
                address: FROM,
                publicKey: '02ab',
                derivationPath: "m/84'/0'/0'/0/0",
                source: 'hd',
            }],
        }),
        getNewestAddress: vi.fn().mockResolvedValue({
            id: 'address-1',
            address: FROM,
            derivationPath: "m/84'/0'/0'/0/0",
            source: 'hd',
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({
            [CHAIN_ID]: { id: 'address-1', address: FROM },
        }),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [],
        }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        listContacts: vi.fn().mockResolvedValue([]),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: '70736274ff',
            encoding: 'P2SH',
            actionString: `SEND|1|BTC|0.01|${TO}`,
            version: 1,
            chainId: CHAIN_ID,
            networkFeeSats: 1234,
            decoded: {
                summary: 'Send 0.01 BTC',
                details: [
                    { label: 'Amount', value: '0.01' },
                    { label: 'Destination', value: TO },
                ],
                warnings: [],
            },
            simulation: { deltas: [], notes: [] },
        }),
        ...overrides,
    };
    return new Proxy(base, {
        get(target, property) {
            if (property in target) return target[property];
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[property] = stub;
            return stub;
        },
    });
}

beforeEach(() => {
    installChromeMock();
    clearDemoWalletId();
    clearLockoutState();
    setBiometricProvider(null);
    resetBackStackForTests();
    window.history.replaceState(null, '', '/');
    closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {});
});

afterEach(() => {
    cleanup();
    closeSpy.mockRestore();
    resetBackStackForTests();
    clearLockoutState();
    setBiometricProvider(null);
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('extension popup keyboard flows', () => {
    it('tabs from the focused password field and unlocks with Enter through chrome.runtime', async () => {
        const user = userEvent.setup();
        const onUnlocked = vi.fn();
        installChromeMock(async ({ type, request }) => {
            if (type === 'wallet.unlock') {
                expect(request).toEqual({ password: 'keyboard secret' });
                return { unlocked: true };
            }
            return null;
        });

        render(popupProvider(
            <Locked onUnlocked={onUnlocked} />,
            { unlockWallet, capturePassphrase: vi.fn() },
        ));

        const password = screen.getByLabelText('Password');
        expect(document.activeElement).toBe(password);
        fireEvent.change(password, { target: { value: 'keyboard secret' } });
        await user.tab();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Forgot password?' }));
        await user.tab();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Unlock Wallet' }));
        await user.keyboard('{Enter}');

        await waitFor(() => expect(onUnlocked).toHaveBeenCalledOnce());
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            { type: 'wallet.unlock', request: { password: 'keyboard secret' } },
            expect.any(Function),
        );
    });

    it('tabs through every Home wallet tab and selects each with Enter', async () => {
        const user = userEvent.setup();
        const messaging = routeMessaging();
        render(popupProvider(
            <HomeTabs
                chainRegistry={defaultRegistry()}
                balances={{}}
                walletId={WALLET_ID}
                networkFilter="all"
                coinFamilies={[]}
                onNetworkFilterChange={() => {}}
                onTokenQueryChange={() => {}}
            />,
            messaging,
        ));

        const tabs = screen.getAllByRole('tab', { name: /^(Coins|Tokens|NFTs|DeFi|Activity)$/ });
        expect(tabs.map((tab) => tab.textContent)).toEqual(['Coins', 'Tokens', 'NFTs', 'DeFi', 'Activity']);
        tabs[0].focus();
        expect(tabs[0]).toHaveAttribute('aria-selected', 'true');

        for (const tab of tabs.slice(1)) {
            await user.tab();
            expect(document.activeElement).toBe(tab);
            await user.keyboard('{Enter}');
            expect(tab).toHaveAttribute('aria-selected', 'true');
        }
    });

    it('tabs through Send fields and opens review with Enter', async () => {
        const user = userEvent.setup();
        const messaging = routeMessaging();
        render(popupProvider(
            <Send walletId={WALLET_ID} onBack={() => {}} />,
            messaging,
        ));

        const destination = await screen.findByLabelText(/^To$/);
        destination.focus();
        await user.tab();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open address book' }));
        await user.tab();
        expect(document.activeElement).toBe(screen.getAllByRole('button', { name: 'Paste from clipboard' })[0]);
        await user.tab();
        expect(document.activeElement).toBe(screen.getByLabelText('Token'));
        await user.tab();
        const amount = screen.getByLabelText(/^Amount \(/);
        expect(document.activeElement).toBe(amount);

        fireEvent.change(destination, { target: { value: TO } });
        fireEvent.change(amount, { target: { value: '0.01' } });
        await user.keyboard('{Enter}');

        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledOnce());
        expect(await screen.findByTestId('confirm-modal')).toBeInTheDocument();
        await waitFor(() => expect(document.activeElement).toBe(
            screen.getByRole('button', { name: 'Back to previous screen' }),
        ));
    });

    it('keeps the Receive request in a logical Token, Amount, paste order', async () => {
        const user = userEvent.setup();
        render(popupProvider(
            <Receive walletId={WALLET_ID} accountId="account-1" onBack={() => {}} />,
            routeMessaging(),
        ));

        const token = await screen.findByRole('button', { name: /^Token:/ });
        const amount = await screen.findByRole('textbox', { name: 'Amount (BTC)' });
        token.focus();
        await user.tab();
        expect(document.activeElement).toBe(amount);
        fireEvent.change(amount, { target: { value: '1.25' } });
        await user.keyboard('{Enter}');
        expect(screen.getByRole('form', { name: 'Receive request' })).toBeInTheDocument();
        await user.tab();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Paste from clipboard' }));
    });
});

describe('extension approval keyboard flows', () => {
    it('accepts a signing request by tabbing from password to Approve', async () => {
        const user = userEvent.setup();
        const decisions = [];
        window.history.replaceState(null, '', '/approval.html?id=sign-request');
        installChromeMock(async ({ type, request }) => {
            if (type === 'approval.fetch') {
                return {
                    id: 'sign-request',
                    kind: 'signMessage',
                    payload: {
                        origin: 'https://keyboard.example',
                        chainId: 'bitcoin-mainnet',
                        payload: { message: 'Keyboard approval' },
                    },
                };
            }
            if (type === 'wallet.list') return [{ id: WALLET_ID, name: 'Keyboard wallet' }];
            if (type === 'settings.get') return { walletMode: 'full' };
            if (type === 'approval.resolve') {
                decisions.push(request.result);
                return { resolved: true };
            }
            return null;
        });

        render(<Router />);
        const password = await screen.findByLabelText('Password');
        fireEvent.change(password, { target: { value: 'approval secret' } });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled());
        password.focus();
        await user.tab();
        expect(document.activeElement).toBe(screen.getByRole('checkbox'));
        await user.tab();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reject' }));
        await user.tab();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Approve' }));
        await user.keyboard('{Enter}');

        await waitFor(() => expect(decisions).toEqual([{
            approved: true,
            walletId: WALLET_ID,
            password: 'approval secret',
        }]));
        expect(closeSpy).toHaveBeenCalledOnce();
    });

    it('rejects a connection request with Escape from its first focusable control', async () => {
        const user = userEvent.setup();
        const decisions = [];
        window.history.replaceState(null, '', '/approval.html?id=connect-request');
        installChromeMock(async ({ type, request }) => {
            if (type === 'approval.fetch') {
                return {
                    id: 'connect-request',
                    kind: 'connect',
                    payload: {
                        origin: 'https://keyboard.example',
                        requestedChains: ['bitcoin-mainnet'],
                    },
                };
            }
            if (type === 'settings.get') return {};
            if (type === 'approval.resolve') {
                decisions.push(request.result);
                return { resolved: true };
            }
            return null;
        });

        render(<Router />);
        const chain = await screen.findByRole('checkbox', { name: /Allow Bitcoin mainnet/ });
        document.body.focus();
        await user.tab();
        expect(document.activeElement).toBe(chain);
        await user.keyboard('{Escape}');

        await waitFor(() => expect(decisions).toEqual([{ approved: false }]));
        expect(closeSpy).toHaveBeenCalledOnce();
    });
});
