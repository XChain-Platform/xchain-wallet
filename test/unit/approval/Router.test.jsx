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
    ListPage: ({ children }) => <div data-testid="list-page">{children}</div>,
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
        <section data-testid="connect-approval">
            <span>{id}:{payload.origin}</span>
            <button type="button" onClick={onReject}>Reject</button>
        </section>
    ),
}));
vi.mock('../../../packages/extension/src/approval/kinds/SignApproval.jsx', () => ({
    SignApproval: ({ id, kind }) => <section data-testid="sign-approval">{id}:{kind}</section>,
}));

const { Router } = await import('../../../packages/extension/src/approval/Router.jsx');

async function renderRoute(id = 'request-1') {
    window.history.replaceState({}, '', `/approval.html${id ? `?id=${id}` : ''}`);
    render(<Router />);
    await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('chrome', {
        runtime: { sendMessage: vi.fn() },
    });
    mocks.resolveApproval.mockResolvedValue({ resolved: true });
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('approval Router', () => {
    it('wraps a missing-id summary in ListPage without messaging the background', async () => {
        await renderRoute('');

        expect(screen.getByTestId('list-page')).toContainElement(screen.getByRole('alert'));
        expect(screen.getByRole('alert').textContent).toBe('Missing approval id in URL.');
        expect(mocks.fetchApproval).not.toHaveBeenCalled();
    });

    it('renders a fetched connect request and settles rejection before closing', async () => {
        mocks.fetchApproval.mockResolvedValue({
            id: 'request-1',
            kind: 'connect',
            payload: { origin: 'https://dapp.test' },
        });
        const close = vi.spyOn(window, 'close').mockImplementation(() => {});

        await renderRoute();
        expect(screen.getByTestId('connect-approval').textContent)
            .toContain('request-1:https://dapp.test');

        fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
        await act(async () => { await Promise.resolve(); });

        expect(mocks.resolveApproval).toHaveBeenCalledWith('request-1', { approved: false });
        expect(close).toHaveBeenCalledOnce();
    });

    it.each(['signMessage', 'signPsbt', 'signAction', 'coSign', 'signIn'])(
        'routes the supported %s kind to the signing screen',
        async (kind) => {
            mocks.fetchApproval.mockResolvedValue({ id: 'request-1', kind, payload: {} });

            await renderRoute();

            expect(screen.getByTestId('sign-approval').textContent)
                .toBe(`request-1:${kind}`);
        },
    );

    it('fails closed instead of treating an unknown kind as a signing request', async () => {
        mocks.fetchApproval.mockResolvedValue({
            id: 'request-1',
            kind: 'futurePrivilegedRequest',
            payload: {},
        });

        await renderRoute();

        expect(screen.getByRole('alert').textContent)
            .toBe('Unsupported approval request type.');
        expect(screen.queryByTestId('sign-approval')).toBeNull();
    });

    it('shows the background error when the parked request cannot be loaded', async () => {
        mocks.fetchApproval.mockRejectedValue(new Error('Approval request expired'));

        await renderRoute();

        expect(screen.getByRole('alert').textContent).toBe('Approval request expired');
    });
});
