// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

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
vi.mock('../../../packages/extension/src/approval/messaging.js', () => mocks);
vi.mock('../../../packages/extension/src/approval/kinds/ConnectApproval.jsx', () => ({
    ConnectApproval: () => <section>Connect request</section>,
}));
vi.mock('../../../packages/extension/src/approval/kinds/SignApproval.jsx', () => ({
    SignApproval: () => <section>Sign request</section>,
}));

const { Router } = await import('../../../packages/extension/src/approval/Router.jsx');

function setRequestId(id) {
    window.history.replaceState({}, '', `/approval.html?id=${id}`);
}

async function flush() {
    await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveApproval.mockResolvedValue({ resolved: true });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('approval Router cancellation branches', () => {
    it('ignores a rejected fetch after the request id changes', async () => {
        let rejectFirst;
        const first = new Promise((_resolve, reject) => { rejectFirst = reject; });
        mocks.fetchApproval
            .mockReturnValueOnce(first)
            .mockResolvedValueOnce({
                id: 'request-2',
                kind: 'connect',
                payload: { origin: 'https://second.test' },
            });
        setRequestId('request-1');
        const view = render(<Router />);

        setRequestId('request-2');
        view.rerender(<Router />);
        await flush();

        await act(async () => {
            rejectFirst(new Error('stale failure'));
            await first.catch(() => {});
        });

        expect(screen.getByText('Connect request')).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('leaves a pre-handled Escape key alone', async () => {
        mocks.fetchApproval.mockResolvedValue({
            id: 'request-1',
            kind: 'connect',
            payload: { origin: 'https://dapp.test' },
        });
        setRequestId('request-1');
        render(<Router />);
        await flush();
        const event = new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
        });
        event.preventDefault();

        window.dispatchEvent(event);
        await flush();

        expect(mocks.resolveApproval).not.toHaveBeenCalled();
    });
});
