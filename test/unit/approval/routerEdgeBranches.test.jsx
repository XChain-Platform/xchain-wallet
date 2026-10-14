// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

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
vi.mock('../../../packages/extension/src/approval/kinds/ConnectApproval.jsx', () => ({
    ConnectApproval: ({ id, payload, onReject }) => (
        <section>
            <span>{id}:{payload.origin}</span>
            <button type="button" onClick={onReject}>Reject</button>
        </section>
    ),
}));
vi.mock('../../../packages/extension/src/approval/kinds/SignApproval.jsx', () => ({
    SignApproval: ({ id }) => <section>{id}</section>,
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

describe('approval Router edge branches', () => {
    it.each([
        null,
        [],
        { id: 'request-1', payload: {} },
        { id: 'request-1', kind: 7, payload: {} },
        { id: 'request-1', kind: 'connect' },
    ])('refuses a malformed broker response %#', async (response) => {
        setRequestId('request-1');
        mocks.fetchApproval.mockResolvedValue(response);

        render(<Router />);
        await flush();

        expect(screen.getByRole('alert')).toHaveTextContent(
            'Approval response did not match this request.',
        );
    });

    it('uses safe copy when the background rejects without an Error', async () => {
        setRequestId('request-1');
        mocks.fetchApproval.mockRejectedValue(null);

        render(<Router />);
        await flush();

        expect(screen.getByRole('alert')).toHaveTextContent('Failed to load request.');
    });

    it('closes after rejection even when the broker connection is lost', async () => {
        setRequestId('request-1');
        mocks.fetchApproval.mockResolvedValue({
            id: 'request-1',
            kind: 'connect',
            payload: { origin: 'https://dapp.test' },
        });
        mocks.resolveApproval.mockRejectedValue(new Error('background disconnected'));
        const close = vi.spyOn(window, 'close').mockImplementation(() => {});

        render(<Router />);
        await flush();
        fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
        await flush();

        expect(mocks.resolveApproval).toHaveBeenCalledWith('request-1', { approved: false });
        expect(close).toHaveBeenCalledOnce();
    });

    it('ignores a stale fetch after the request id changes', async () => {
        let resolveFirst;
        const first = new Promise((resolve) => { resolveFirst = resolve; });
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
        expect(screen.getByText('request-2:https://second.test')).toBeTruthy();

        await act(async () => {
            resolveFirst({
                id: 'request-1',
                kind: 'connect',
                payload: { origin: 'https://stale.test' },
            });
            await first;
        });

        expect(screen.getByText('request-2:https://second.test')).toBeTruthy();
        expect(screen.queryByText(/stale\.test/)).toBeNull();
    });
});
