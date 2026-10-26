// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import {
    BackgroundConnectionState,
    connectToBackground,
} from '../../../packages/extension/src/popup/backgroundConnection.jsx';
import { getSessionStatus } from '../../../packages/extension/src/popup/messaging.js';
import {
    BACKGROUND_INTERRUPTED_MESSAGE,
    READ_RETRY_DELAYS_MS,
    RUNTIME_MESSAGE_TIMEOUT_MS,
    RUNTIME_REQUEST_TIMEOUT_MS,
    sendMessage,
} from '../../../packages/extension/src/shared/chromeMessaging.js';
import { Router as ApprovalRouter } from '../../../packages/extension/src/approval/Router.jsx';
import { sequenceUnlockedSession } from '../../../packages/extension/src/background/walletLock.js';

function reply(runtime, callback, response, lastError) {
    runtime.lastError = lastError;
    callback(response);
    runtime.lastError = undefined;
}

function ConnectionHarness({ onReload = () => {} }) {
    const [state, setState] = useState('connecting');

    useEffect(() => {
        connectToBackground(
            getSessionStatus,
            {
                retryDelays: [1, 1],
                onRetry: () => setState('reconnecting'),
            },
        ).then(() => setState('ready')).catch(() => setState('failed'));
    }, []);

    if (state === 'reconnecting') return <BackgroundConnectionState />;
    if (state === 'failed') return <BackgroundConnectionState failed onReload={onReload} />;
    return <p>{state === 'ready' ? 'Wallet ready' : 'Connecting to wallet...'}</p>;
}

function renderHarness(props) {
    return render(
        <MessagingProvider shell="popup" messaging={{}}>
            <ConnectionHarness {...props} />
        </MessagingProvider>,
    );
}

async function flushPromises() {
    await act(async () => {
        await Promise.resolve();
    });
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('popup background connection recovery', () => {
    it('applies a finite deadline to ordinary background requests', async () => {
        const runtime = { lastError: undefined, sendMessage: vi.fn() };
        vi.stubGlobal('chrome', { runtime });
        const request = sendMessage('wallet.list');
        const rejection = expect(request).rejects.toMatchObject({ code: 'RUNTIME_TIMEOUT' });

        await vi.advanceTimersByTimeAsync(RUNTIME_REQUEST_TIMEOUT_MS);

        await rejection;
    });

    it('does not time out a user-authorized action while hardware may still be waiting', async () => {
        let replyAction;
        const runtime = {
            lastError: undefined,
            sendMessage: vi.fn((_message, callback) => { replyAction = callback; }),
        };
        vi.stubGlobal('chrome', { runtime });
        const request = sendMessage('action.send.hw', { walletId: 'wallet-1' });

        await vi.advanceTimersByTimeAsync(RUNTIME_REQUEST_TIMEOUT_MS);
        replyAction({ ok: true, result: { txid: 'abc' } });

        await expect(request).resolves.toEqual({ txid: 'abc' });
    });

    it('shows reconnecting and recovers when the service worker restarts', async () => {
        const runtime = { lastError: undefined, sendMessage: vi.fn() };
        runtime.sendMessage
            .mockImplementationOnce((_message, callback) => reply(
                runtime,
                callback,
                undefined,
                { message: 'Could not establish connection. Receiving end does not exist.' },
            ))
            .mockImplementationOnce((_message, callback) => reply(runtime, callback, {
                ok: true,
                result: { state: 'locked' },
            }));
        vi.stubGlobal('chrome', { runtime });

        renderHarness();
        await flushPromises();
        expect(screen.getByRole('status')).toHaveTextContent('Reconnecting to wallet…');

        await vi.advanceTimersByTimeAsync(1);
        await flushPromises();
        expect(screen.getByText('Wallet ready')).toBeInTheDocument();
        expect(runtime.sendMessage).toHaveBeenCalledTimes(2);
    });

    it('times out a lost message, shows reconnecting, and recovers', async () => {
        const runtime = { lastError: undefined, sendMessage: vi.fn() };
        runtime.sendMessage
            .mockImplementationOnce(() => {})
            .mockImplementationOnce((_message, callback) => reply(runtime, callback, {
                ok: true,
                result: { state: 'unlocked' },
            }));
        vi.stubGlobal('chrome', { runtime });

        renderHarness();
        await vi.advanceTimersByTimeAsync(RUNTIME_MESSAGE_TIMEOUT_MS);
        await flushPromises();
        expect(screen.getByRole('status')).toHaveTextContent('Reconnecting to wallet…');

        await vi.advanceTimersByTimeAsync(1);
        await flushPromises();
        expect(screen.getByText('Wallet ready')).toBeInTheDocument();
    });

    it('offers Reload when the message port keeps disconnecting mid-request', async () => {
        const onReload = vi.fn();
        const runtime = {
            lastError: undefined,
            sendMessage: vi.fn((_message, callback) => reply(
                runtime,
                callback,
                undefined,
                { message: 'The message port closed before a response was received.' },
            )),
        };
        vi.stubGlobal('chrome', { runtime });

        renderHarness({ onReload });
        await vi.advanceTimersByTimeAsync(2);
        await flushPromises();

        expect(screen.getByRole('alert')).toHaveTextContent('Unable to reconnect');
        fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
        expect(onReload).toHaveBeenCalledOnce();
        expect(runtime.sendMessage).toHaveBeenCalledTimes(3);
    });
});

describe('reads repeated while the service worker wakes', () => {
    const closedPort = { message: 'The message port closed before a response was received.' };

    it('repeats a read whose port closed until the worker answers', async () => {
        const runtime = { lastError: undefined, sendMessage: vi.fn() };
        runtime.sendMessage
            .mockImplementationOnce((_message, callback) => reply(runtime, callback, undefined, closedPort))
            .mockImplementationOnce((_message, callback) => reply(runtime, callback, undefined, closedPort))
            .mockImplementationOnce((_message, callback) => reply(runtime, callback, { ok: true, result: { theme: 'dark' } }));
        vi.stubGlobal('chrome', { runtime });

        const request = sendMessage('settings.get');
        await vi.advanceTimersByTimeAsync(READ_RETRY_DELAYS_MS[0] + READ_RETRY_DELAYS_MS[1]);

        await expect(request).resolves.toEqual({ theme: 'dark' });
        expect(runtime.sendMessage).toHaveBeenCalledTimes(3);
    });

    it('gives up with the restart sentence after the last delay', async () => {
        const runtime = { lastError: undefined, sendMessage: vi.fn() };
        runtime.sendMessage.mockImplementation((_message, callback) => reply(runtime, callback, undefined, closedPort));
        vi.stubGlobal('chrome', { runtime });

        const request = sendMessage('wallet.list');
        const rejection = expect(request).rejects.toMatchObject({
            code: 'RUNTIME_DISCONNECTED',
            message: BACKGROUND_INTERRUPTED_MESSAGE,
        });
        await vi.advanceTimersByTimeAsync(READ_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0));

        await rejection;
        expect(runtime.sendMessage).toHaveBeenCalledTimes(READ_RETRY_DELAYS_MS.length + 1);
    });

    it('never repeats a write, which the worker may have finished', async () => {
        const runtime = { lastError: undefined, sendMessage: vi.fn() };
        runtime.sendMessage.mockImplementation((_message, callback) => reply(runtime, callback, undefined, closedPort));
        vi.stubGlobal('chrome', { runtime });

        const rejection = expect(sendMessage('action.sendToken', { walletId: 'w' }))
            .rejects.toMatchObject({ code: 'RUNTIME_DISCONNECTED' });
        await vi.advanceTimersByTimeAsync(5000);

        await rejection;
        expect(runtime.sendMessage).toHaveBeenCalledOnce();
    });

    it('does not repeat a read the worker answered with an error', async () => {
        const runtime = { lastError: undefined, sendMessage: vi.fn() };
        runtime.sendMessage.mockImplementation((_message, callback) => reply(runtime, callback, {
            ok: false,
            error: { name: 'VaultLockedError', message: 'locked' },
        }));
        vi.stubGlobal('chrome', { runtime });

        await expect(sendMessage('settings.get')).rejects.toMatchObject({ name: 'VaultLockedError' });
        expect(runtime.sendMessage).toHaveBeenCalledOnce();
    });
});

describe('service-worker interruption safety', () => {
    it('reports a pending signature interruption without exposing Chrome internals', async () => {
        const runtime = { lastError: undefined, sendMessage: vi.fn() };
        runtime.sendMessage.mockImplementation((_message, callback) => reply(
            runtime,
            callback,
            undefined,
            { message: 'The message port closed before a response was received.' },
        ));
        vi.stubGlobal('chrome', { runtime });

        const error = await sendMessage('auth.signMessage', { message: 'reviewed' })
            .catch((caught) => caught);

        expect(error).toMatchObject({
            name: 'RuntimeConnectionError',
            code: 'RUNTIME_DISCONNECTED',
            message: BACKGROUND_INTERRUPTED_MESSAGE,
        });
        expect(error.message).not.toMatch(/message port|response/i);
        expect(runtime.sendMessage).toHaveBeenCalledOnce();
    });

    it('fails a lost approval closed with a plain recovery message', async () => {
        const runtime = { lastError: undefined, sendMessage: vi.fn() };
        runtime.sendMessage.mockImplementation((_message, callback) => reply(runtime, callback, {
            ok: false,
            error: {
                name: 'ApprovalNotFoundError',
                message: 'approval.fetch: unknown id "lost-request"',
            },
        }));
        vi.stubGlobal('chrome', { runtime });
        window.history.replaceState({}, '', '/approval.html?id=lost-request');

        render(
            <MessagingProvider shell="approval" messaging={{}}>
                <ApprovalRouter />
            </MessagingProvider>,
        );
        await flushPromises();

        expect(screen.getByRole('alert')).toHaveTextContent(
            'This approval was interrupted. Return to the site and try again.',
        );
        expect(screen.getByRole('alert')).not.toHaveTextContent('unknown id');
    });

    it('finishes clearing stale auto-lock state before the UI can re-arm it', async () => {
        let finishClear;
        const clearAutoLockState = vi.fn(() => new Promise((resolve) => {
            finishClear = resolve;
        }));
        const continueUnlock = vi.fn(async () => 'unlocked');

        const pending = sequenceUnlockedSession({ clearAutoLockState, continueUnlock });
        await flushPromises();
        expect(continueUnlock).not.toHaveBeenCalled();

        finishClear();
        await expect(pending).resolves.toBe('unlocked');
        expect(continueUnlock).toHaveBeenCalledOnce();
    });
});
