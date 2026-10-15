// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../packages/extension/src/popup/App.jsx';

const mocks = vi.hoisted(() => ({ deepLinkRoute: vi.fn() }));

vi.mock('../../../packages/desktop/renderer/deepLinkRoute.js', () => ({
    deepLinkRoute: mocks.deepLinkRoute,
}));

function installChrome(sessionReply, tabs) {
    const listeners = new Set();
    const runtime = {
        lastError: undefined,
        sendMessage: vi.fn((message, callback) => {
            if (message.type === 'session.status') callback(sessionReply);
            else callback({ ok: false, error: { name: 'Error', message: 'not available' } });
        }),
    };
    vi.stubGlobal('chrome', {
        runtime,
        tabs,
        storage: {
            onChanged: {
                addListener: (listener) => listeners.add(listener),
                removeListener: (listener) => listeners.delete(listener),
            },
            local: { get: (_key, callback) => callback({}) },
            session: { get: (_key, callback) => callback({}) },
        },
    });
    return runtime;
}

beforeEach(() => {
    mocks.deepLinkRoute.mockReset();
    localStorage.setItem('xc:onboardingExplainerSeenAt', '2026-10-13T00:00:00.000Z');
    localStorage.setItem('xc:licenseAcceptedAt', '2026-10-13T00:00:00.000Z');
    localStorage.setItem('xc:licenseAcceptedVersion', '2');
    window.history.replaceState(null, '', '/popup.html');
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
});

describe('popup App defensive branches', () => {
    it('shows a plain note when the side panel active tab has no content bridge', async () => {
        window.history.replaceState(null, '', '/sidepanel.html');
        const onActivated = { addListener: vi.fn(), removeListener: vi.fn() };
        const onUpdated = { addListener: vi.fn(), removeListener: vi.fn() };
        let sendFailed = false;
        const tabs = {
            query: vi.fn((_query, callback) => callback([{ id: 7 }])),
            sendMessage: vi.fn((_tabId, _message, callback) => {
                sendFailed = true;
                callback(undefined);
            }),
            onActivated,
            onUpdated,
        };
        const runtime = installChrome({ ok: true, result: { state: 'unlocked' } }, tabs);
        Object.defineProperty(runtime, 'lastError', {
            configurable: true,
            get: () => (sendFailed
                ? { message: 'Could not establish connection. Receiving end does not exist.' }
                : undefined),
        });

        render(<App />);

        expect(await screen.findByRole('status')).toHaveTextContent(
            "XChain Wallet can't connect to this page.",
        );
        expect(runtime.sendMessage).not.toHaveBeenCalled();
        expect(tabs.sendMessage).toHaveBeenCalledWith(
            7,
            { type: 'xchain.contentProbe' },
            expect.any(Function),
        );
    });

    it('loads the wallet in the side panel when the active tab answers the probe', async () => {
        window.history.replaceState(null, '', '/sidepanel.html');
        const tabs = {
            query: vi.fn((_query, callback) => callback([{ id: 8 }])),
            sendMessage: vi.fn((_tabId, _message, callback) => callback({ available: true })),
            onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
            onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
        };
        installChrome({ ok: true, result: { state: 'no-wallet' } }, tabs);

        render(<App />);

        expect(await screen.findByRole('button', { name: 'Create new wallet' }))
            .toBeInTheDocument();
        expect(screen.queryByText('XChain Wallet cannot connect to this page.'))
            .not.toBeInTheDocument();
    });

    it('shows the generic startup failure for a permission refusal', async () => {
        installChrome({
            ok: false,
            error: { name: 'NotAllowedError', message: 'storage permission refused' },
        });

        render(<App />);

        expect(await screen.findByRole('alert')).toHaveTextContent('Something stopped the wallet from opening.');
        expect(screen.getByRole('heading', { name: /wallet couldn't start/i })).toBeInTheDocument();
        expect(screen.queryByText('storage permission refused')).not.toBeInTheDocument();
    });

    it('routes a locked-vault startup failure to its dedicated recovery screen', async () => {
        installChrome({
            ok: false,
            error: { name: 'VaultLockedError', message: 'secure storage is locked' },
        });

        render(<App />);

        expect(await screen.findByRole('heading', { name: 'Your device needs to be unlocked' }))
            .toBeInTheDocument();
        expect(screen.queryByText('secure storage is locked')).not.toBeInTheDocument();
    });

    it('strips a deep link even when the shared parser throws unexpectedly', async () => {
        installChrome({ ok: true, result: { state: 'no-wallet' } });
        mocks.deepLinkRoute.mockImplementation(() => { throw new Error('parser crashed'); });
        window.history.replaceState(
            null,
            '',
            '/popup.html?uri=web%2Bxchain%3A%2F%2Fbad&keep=1#fragment',
        );

        render(<App />);

        await waitFor(() => expect(mocks.deepLinkRoute).toHaveBeenCalledOnce());
        expect(window.location.pathname).toBe('/popup.html');
        expect(window.location.search).toBe('?keep=1');
        expect(window.location.hash).toBe('#fragment');
        expect(await screen.findByRole('button', { name: 'Create new wallet' }))
            .toBeInTheDocument();
    });
});
