// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registry as registryLib } from '@xchain-wallet/core';
import { App } from '../../../packages/extension/src/popup/App.jsx';
import { usePopupPaletteData } from '../../../packages/extension/src/popup/usePopupPaletteData.js';
import { SURFACE_STATE_STORAGE_KEY } from '../../../packages/extension/src/shared/surfaceStateSync.js';

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
});

describe('popup App lifecycle', () => {
    it('ignores an older session response after a newer refresh completes', async () => {
        localStorage.setItem('xc:onboardingExplainerSeenAt', '2026-10-13T00:00:00.000Z');
        localStorage.setItem('xc:licenseAcceptedAt', '2026-10-13T00:00:00.000Z');
        localStorage.setItem('xc:licenseAcceptedVersion', '2');
        const storageListeners = new Set();
        const firstSession = deferred();
        let sessionRequests = 0;
        const runtime = {
            lastError: undefined,
            getURL: (path) => `chrome-extension://wallet/${path}`,
            sendMessage: vi.fn((message, callback) => {
                if (message.type !== 'session.status') {
                    callback({ ok: false, error: { name: 'Error', message: 'not available' } });
                    return;
                }
                sessionRequests += 1;
                if (sessionRequests === 1) {
                    firstSession.promise.then(callback);
                    return;
                }
                callback({ ok: true, result: { state: 'no-wallet' } });
            }),
        };
        vi.stubGlobal('chrome', {
            runtime,
            storage: {
                onChanged: {
                    addListener: (listener) => storageListeners.add(listener),
                    removeListener: (listener) => storageListeners.delete(listener),
                },
                local: { get: (_key, callback) => callback({}) },
                session: { get: (_key, callback) => callback({}) },
            },
        });

        render(<App />);
        await waitFor(() => expect(sessionRequests).toBe(1));

        act(() => {
            for (const listener of storageListeners) {
                listener({
                    [SURFACE_STATE_STORAGE_KEY]: {
                        newValue: { kind: 'session', payload: {}, revision: '2' },
                    },
                }, 'session');
            }
        });
        expect(await screen.findByRole('button', { name: 'Create new wallet' })).toBeInTheDocument();

        await act(async () => {
            firstSession.resolve({ ok: true, result: { state: 'locked' } });
            await firstSession.promise;
        });
        expect(screen.getByRole('button', { name: 'Create new wallet' })).toBeInTheDocument();
        expect(screen.queryByRole('form', { name: 'Unlock wallet' })).not.toBeInTheDocument();
    });

    it('clears palette entities on close and ignores results from the previous wallet', async () => {
        const firstContacts = deferred();
        const secondContacts = deferred();
        const messaging = {
            listContacts: vi.fn()
                .mockReturnValueOnce(firstContacts.promise)
                .mockReturnValueOnce(secondContacts.promise),
            getWalletBalances: vi.fn(async () => ({})),
            listConnectedSites: vi.fn(async () => []),
        };
        const chainRegistry = registryLib.defaultRegistry();
        const props = {
            open: true,
            sessionState: 'unlocked',
            walletId: 'wallet-a',
            accountId: null,
            messaging,
            chainRegistry,
            loadSites: messaging.listConnectedSites,
        };
        const { result, rerender } = renderHook(
            (next) => usePopupPaletteData(next),
            { initialProps: props },
        );

        rerender({ ...props, walletId: 'wallet-b' });
        await act(async () => {
            firstContacts.resolve([{ id: 'contact-a' }]);
            await firstContacts.promise;
        });
        expect(result.current.contacts).toEqual([]);

        await act(async () => {
            secondContacts.resolve([{ id: 'contact-b' }]);
            await secondContacts.promise;
        });
        await waitFor(() => expect(result.current.contacts).toEqual([{ id: 'contact-b' }]));

        rerender({ ...props, open: false, walletId: 'wallet-b' });
        await waitFor(() => expect(result.current.contacts).toEqual([]));
        expect(result.current.tokenRows).toEqual([]);
        expect(result.current.sites).toEqual([]);
    });
});
