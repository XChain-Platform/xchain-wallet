// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// An approval window learns that the service worker holding its request
// stopped the moment its watch port closes, not when the user presses Sign.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

import {
    APPROVAL_WATCH_PORT,
    attachApprovalWatchListener,
    watchApprovalWorker,
} from '../../../packages/extension/src/shared/approvalWatch.js';

const mocks = vi.hoisted(() => ({
    fetchApproval: vi.fn(),
    resolveApproval: vi.fn(),
}));

vi.mock('@xchain-wallet/core/ui', () => ({
    Screen: ({ children }) => <main>{children}</main>,
    ListPage: ({ children }) => <div>{children}</div>,
}));
vi.mock('@xchain-wallet/core/shared/components/RouteErrorBoundary.jsx', () => ({
    RouteErrorBoundary: ({ children }) => children,
}));
vi.mock('../../../packages/extension/src/approval/messaging.js', () => ({
    fetchApproval: mocks.fetchApproval,
    resolveApproval: mocks.resolveApproval,
}));
vi.mock('../../../packages/extension/src/approval/kinds/SignApproval.jsx', () => ({
    SignApproval: () => <label>Password<input type="password" /></label>,
}));
vi.mock('../../../packages/extension/src/approval/kinds/ConnectApproval.jsx', () => ({
    ConnectApproval: () => <section>connect</section>,
}));

const { Router } = await import('../../../packages/extension/src/approval/Router.jsx');

function fakePort(name) {
    const onDisconnect = new Set();
    return {
        name,
        disconnected: false,
        onDisconnect: { addListener: (fn) => onDisconnect.add(fn) },
        disconnect() { this.disconnected = true; },
        drop() { for (const fn of onDisconnect) fn(); },
        watchers: () => onDisconnect.size,
    };
}

function fakeRuntime() {
    const ports = [];
    return {
        ports,
        connect: vi.fn(({ name }) => {
            const port = fakePort(name);
            ports.push(port);
            return port;
        }),
    };
}

const INTERRUPTED = 'This request ended when the wallet restarted.';
function interrupted() {
    const err = new Error(INTERRUPTED);
    err.name = 'ApprovalInterruptedError';
    return err;
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

afterEach(() => {
    cleanup();
    delete globalThis.chrome;
    vi.clearAllMocks();
    vi.useRealTimers();
});

describe('approval worker watch', () => {
    it('reports a lost request when the port closes and the broker does not hold it', async () => {
        const runtime = fakeRuntime();
        const onLost = vi.fn();
        watchApprovalWorker({ stillParked: () => Promise.reject(interrupted()), onLost, runtime });
        expect(runtime.connect).toHaveBeenCalledWith({ name: APPROVAL_WATCH_PORT });

        runtime.ports[0].drop();
        await flush();

        expect(onLost).toHaveBeenCalledTimes(1);
        expect(onLost.mock.calls[0][0].name).toBe('ApprovalInterruptedError');
    });

    it('reconnects when the port closes while the request is still parked', async () => {
        vi.useFakeTimers();
        const runtime = fakeRuntime();
        const onLost = vi.fn();
        watchApprovalWorker({ stillParked: () => Promise.resolve({}), onLost, runtime, reconnectMs: 10 });

        runtime.ports[0].drop();
        await flush();
        await act(async () => { await vi.advanceTimersByTimeAsync(10); });

        expect(onLost).not.toHaveBeenCalled();
        expect(runtime.connect).toHaveBeenCalledTimes(2);
    });

    it('closes its port and ignores a later close once stopped', async () => {
        const runtime = fakeRuntime();
        const onLost = vi.fn();
        const stop = watchApprovalWorker({ stillParked: () => Promise.reject(interrupted()), onLost, runtime });
        stop();
        expect(runtime.ports[0].disconnected).toBe(true);
        runtime.ports[0].drop();
        await flush();
        expect(onLost).not.toHaveBeenCalled();
    });

    it('holds an extension page port open and closes one from a web page', () => {
        let listener;
        const runtime = { id: 'ext', onConnect: { addListener: (fn) => { listener = fn; }, removeListener: vi.fn() } };
        attachApprovalWatchListener(runtime);

        const trusted = fakePort(APPROVAL_WATCH_PORT);
        trusted.sender = { id: 'ext', url: 'chrome-extension://ext/approval.html' };
        listener(trusted);
        expect(trusted.disconnected).toBe(false);
        expect(trusted.watchers()).toBe(1);

        const page = fakePort(APPROVAL_WATCH_PORT);
        page.sender = { id: 'ext', url: 'https://example.com/', tab: { id: 3 } };
        listener(page);
        expect(page.disconnected).toBe(true);

        const other = fakePort('signer-bridge');
        other.sender = { id: 'ext', url: 'https://example.com/', tab: { id: 3 } };
        listener(other);
        expect(other.disconnected).toBe(false);
    });
});

describe('approval window after a worker restart', () => {
    it('replaces the password field with the interrupted note as soon as the worker stops', async () => {
        const runtime = fakeRuntime();
        globalThis.chrome = { runtime };
        window.history.replaceState({}, '', '/approval.html?id=req-1');
        mocks.fetchApproval.mockResolvedValueOnce({ id: 'req-1', kind: 'signMessage', payload: {} });

        render(<Router />);
        await flush();
        expect(screen.getByLabelText('Password')).toBeInTheDocument();
        expect(runtime.connect).toHaveBeenCalledWith({ name: APPROVAL_WATCH_PORT });

        mocks.fetchApproval.mockRejectedValueOnce(interrupted());
        await act(async () => { runtime.ports[0].drop(); });
        await flush();

        expect(screen.getByRole('alert')).toHaveTextContent(INTERRUPTED);
        expect(screen.queryByLabelText('Password')).toBeNull();
        expect(mocks.resolveApproval).not.toHaveBeenCalled();
    });
});
