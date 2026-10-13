// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import { ConnectedSites } from '../../../packages/core/src/shared/routes/ConnectedSites.jsx';
import { Router } from '../../../packages/extension/src/approval/Router.jsx';
import { ApprovalBroker } from '../../../packages/extension/src/background/approvalBroker.js';
import * as popupMessaging from '../../../packages/extension/src/popup/messaging.js';

const REQUESTS = [
    {
        origin: 'https://approved.example',
        appName: 'Approved dApp',
        requestedChains: ['bitcoin-mainnet'],
        accountOptions: [{ id: 'account-1', name: 'Main account' }],
    },
    {
        origin: 'https://rejected.example',
        appName: 'Rejected dApp',
        requestedChains: ['bitcoin-mainnet'],
        accountOptions: [{ id: 'account-1', name: 'Main account' }],
    },
];

function messageError(error) {
    return {
        name: error?.name || 'Error',
        message: error?.message || String(error),
    };
}

function mountPopup(child) {
    return render(
        <MessagingContext.Provider value={{ shell: 'popup', messaging: popupMessaging }}>
            {child}
        </MessagingContext.Provider>,
    );
}

function createBackground() {
    const sites = [];
    const action = { setBadgeText: vi.fn(async () => {}) };
    const windows = {
        create: vi.fn(async ({ url }) => ({ id: Number(new URL(url).searchParams.get('id').split('-')[1]) })),
        remove: vi.fn(async () => {}),
        onRemoved: { addListener: vi.fn() },
    };
    let nextRequestId = 1;
    const broker = new ApprovalBroker({
        action,
        windows,
        getUrl: (path) => `chrome-extension://wallet/${path}`,
        newId: () => `request-${nextRequestId++}`,
    });
    const settings = createDefaultSettings();

    async function dispatch({ type, request }) {
        if (type === 'wallet.unlock') {
            if (request?.password !== 'correct password') throw new Error('unexpected password');
            return { unlocked: true };
        }
        if (type === 'approval.fetch') {
            const approval = broker.fetch(request?.id);
            if (!approval) throw new Error('approval not found');
            return approval;
        }
        if (type === 'approval.resolve') {
            return { resolved: await broker.resolve(request?.id, request?.result) };
        }
        if (type === 'settings.get') return settings;
        if (type === 'sites.list') return [...sites];
        if (type === 'sites.listBlocked' || type === 'sites.auditLog.list') return [];
        throw new Error(`unhandled background message: ${type}`);
    }

    const runtime = {
        getURL: (path) => `chrome-extension://wallet/${path}`,
        lastError: undefined,
        sendMessage: vi.fn((message, callback) => {
            Promise.resolve()
                .then(() => dispatch(message))
                .then(
                    (result) => callback({ ok: true, result }),
                    (error) => callback({ ok: false, error: messageError(error) }),
                );
        }),
    };

    function requestConnection(payload) {
        return broker.connect(payload).then((decision) => {
            if (decision?.approved) {
                sites.push({
                    id: `site-${sites.length + 1}`,
                    origin: payload.origin,
                    appName: payload.appName,
                    connectedAt: '2026-10-13T12:00:00.000Z',
                    lastUsedAt: '2026-10-13T12:00:00.000Z',
                    permissions: {
                        chains: decision.chains,
                        accounts: decision.accounts,
                        canSignMessage: decision.canSignMessage,
                        canSignAction: decision.canSignAction,
                    },
                });
            }
            return decision;
        });
    }

    return { action, broker, requestConnection, runtime, sites, windows };
}

describe('extension popup connection approval flow', () => {
    let background;
    let close;

    beforeEach(() => {
        localStorage.clear();
        background = createBackground();
        vi.stubGlobal('chrome', {
            action: background.action,
            runtime: background.runtime,
            windows: background.windows,
        });
        close = vi.spyOn(window, 'close').mockImplementation(() => {});
    });

    afterEach(() => {
        close.mockRestore();
        vi.unstubAllGlobals();
        window.history.replaceState(null, '', '/');
    });

    it('unlocks, approves and rejects pending dApps, and reconciles badge and sites', async () => {
        const unlocked = vi.fn();
        mountPopup(<Locked onUnlocked={unlocked} />);

        expect(screen.getByRole('form', { name: 'Unlock wallet' })).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Password'), {
            target: { value: 'correct password' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Unlock Wallet' }));
        await waitFor(() => expect(unlocked).toHaveBeenCalledOnce());
        expect(background.runtime.sendMessage).toHaveBeenCalledWith(
            { type: 'wallet.unlock', request: { password: 'correct password' } },
            expect.any(Function),
        );

        const approved = background.requestConnection(REQUESTS[0]);
        const rejected = background.requestConnection(REQUESTS[1]);
        await waitFor(() => {
            expect(background.action.setBadgeText).toHaveBeenLastCalledWith({ text: '2' });
        });

        cleanup();
        window.history.replaceState(null, '', '/approval.html?id=request-1');
        render(<Router />);
        expect(await screen.findByText('Connection request')).toBeInTheDocument();
        expect(screen.getByText('https://approved.example')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

        await expect(approved).resolves.toMatchObject({ approved: true });
        await waitFor(() => {
            expect(background.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' });
        });
        expect(close).toHaveBeenCalledTimes(1);

        cleanup();
        mountPopup(<ConnectedSites onBack={() => {}} />);
        expect(await screen.findByText('Approved dApp')).toBeInTheDocument();
        expect(screen.queryByText('Rejected dApp')).not.toBeInTheDocument();

        cleanup();
        window.history.replaceState(null, '', '/approval.html?id=request-2');
        render(<Router />);
        expect(await screen.findByText('https://rejected.example')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Reject' }));

        await expect(rejected).resolves.toEqual({ approved: false });
        await waitFor(() => {
            expect(background.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
        });

        cleanup();
        mountPopup(<ConnectedSites onBack={() => {}} />);
        expect(await screen.findByText('Approved dApp')).toBeInTheDocument();
        expect(screen.queryByText('Rejected dApp')).not.toBeInTheDocument();
        expect(background.sites).toHaveLength(1);
    });
});
