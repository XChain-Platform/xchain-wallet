// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    App,
    SESSION_STATUS_TIMEOUT_MS,
} from '../../../packages/desktop/renderer/App.jsx';

function success(result) {
    return Promise.resolve({ ok: true, result });
}

function installPreloadBridge(loadSession) {
    const sendMessage = vi.fn(({ type }) => (
        type === 'session.status' ? loadSession() : success(null)
    ));
    globalThis.xchainWalletBridge = { sendMessage };
    return sendMessage;
}

function renderShell() {
    const onShellAction = vi.fn();
    render(
        <>
            <button type="button" onClick={onShellAction}>Shell action</button>
            <App />
        </>,
    );
    return onShellAction;
}

async function expectPlainFailure(onShellAction, privateDetail) {
    expect(await screen.findByRole('heading', { name: /wallet couldn't start/i })).toBeTruthy();
    expect(document.body.textContent).not.toContain(privateDetail);
    fireEvent.click(screen.getByRole('button', { name: 'Shell action' }));
    expect(onShellAction).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
}

beforeEach(() => {
    localStorage.clear();
    delete globalThis.xchainWalletBridge;
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    delete globalThis.xchainWalletBridge;
});

describe('desktop renderer IPC failure recovery', () => {
    it('shows a plain retry screen when the main handler rejects', async () => {
        let attempts = 0;
        const sendMessage = installPreloadBridge(() => {
            attempts += 1;
            return attempts === 1
                ? Promise.reject(new Error('private main-process path'))
                : success({ state: 'no-wallet' });
        });
        const onShellAction = renderShell();

        await expectPlainFailure(onShellAction, 'private main-process path');
        fireEvent.click(screen.getByRole('button', { name: /try again/i }));

        await waitFor(() => expect(screen.getByLabelText('License terms')).toBeTruthy());
        expect(sendMessage.mock.calls.filter(([message]) => message.type === 'session.status'))
            .toHaveLength(2);
    });

    it('times out a slow main process and retries without remounting the shell', async () => {
        vi.useFakeTimers();
        let attempts = 0;
        installPreloadBridge(() => {
            attempts += 1;
            return attempts === 1
                ? new Promise(() => {})
                : success({ state: 'no-wallet' });
        });
        const onShellAction = renderShell();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(SESSION_STATUS_TIMEOUT_MS);
        });
        vi.useRealTimers();
        await expectPlainFailure(onShellAction, 'The desktop service did not respond.');
        fireEvent.click(screen.getByRole('button', { name: /try again/i }));
        await act(async () => { await Promise.resolve(); });

        expect(screen.getByLabelText('License terms')).toBeTruthy();
        expect(attempts).toBe(2);
    });

    it('recovers when the preload bridge appears after a missing-bridge failure', async () => {
        const onShellAction = renderShell();

        await expectPlainFailure(onShellAction, 'xchainWalletBridge not exposed');
        const sendMessage = installPreloadBridge(() => success({ state: 'no-wallet' }));
        fireEvent.click(screen.getByRole('button', { name: /try again/i }));

        await waitFor(() => expect(screen.getByLabelText('License terms')).toBeTruthy());
        expect(sendMessage).toHaveBeenCalledWith({ type: 'session.status', request: undefined });
    });
});
