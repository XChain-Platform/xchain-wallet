// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';

const mocks = vi.hoisted(() => ({
    fetchApproval: vi.fn(),
    resolveApproval: vi.fn(),
}));

vi.mock('@xchain-wallet/core/ui', () => ({
    Screen: ({ children }) => <main>{children}</main>,
    ListPage: ({ children }) => <div data-testid="list-page">{children}</div>,
    Notice: ({ children }) => <div role="alert">{children}</div>,
    Skeleton: ({ ariaLabel }) => <span role="status" aria-label={ariaLabel} />,
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
    it('uses a content-shaped status while the request is loading', async () => {
        mocks.fetchApproval.mockImplementation(() => new Promise(() => {}));

        await renderRoute();

        expect(screen.getByRole('status', { name: 'Loading approval request…' })).toBeTruthy();
        expect(screen.queryByText('Loading approval request…')).toBeNull();
    });

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

    it('refuses a broker response for a different approval id', async () => {
        mocks.fetchApproval.mockResolvedValue({
            id: 'another-request',
            kind: 'connect',
            payload: { origin: 'https://dapp.test' },
        });

        await renderRoute('request-1');

        expect(screen.getByRole('alert').textContent)
            .toBe('Approval response did not match this request.');
        expect(screen.queryByTestId('connect-approval')).toBeNull();
    });

    it('keeps help off page headers and preserves whole-word wrapping', () => {
        const header = readFileSync('packages/extension/src/approval/ApprovalHeader.jsx', 'utf8');
        const connect = readFileSync('packages/extension/src/approval/kinds/ConnectApproval.jsx', 'utf8');
        const locale = readFileSync('packages/core/src/i18n/locales/en/extension.js', 'utf8');
        const sharedCss = readFileSync('packages/extension/src/approval/approval.module.css', 'utf8');
        const signCss = readFileSync('packages/extension/src/approval/kinds/SignApproval.module.css', 'utf8');

        expect(header).not.toMatch(/InfoTip|trailing=|\{ title, help \}/);
        expect(locale).toContain("'extension.connect.title': 'Connect Wallet'");
        expect(connect.indexOf('testId="connect-error-summary"'))
            .toBeLessThan(connect.indexOf('styles.siteIdentity'));
        expect(connect).not.toContain('CONNECT_SITE_WARNING');
        expect(connect).not.toMatch(/<div className=\{shared\.error\} role="alert"/);
        expect(sharedCss).not.toMatch(/word-break:\s*break-all/);
        expect(signCss).not.toMatch(/word-break:\s*break-all/);
    });
});

describe('approval messaging', () => {
    it('reports an interrupted approval when the broker did not settle it', async () => {
        chrome.runtime.sendMessage.mockImplementation((_message, respond) => {
            respond({ ok: true, result: { resolved: false } });
        });
        const messaging = await vi.importActual(
            '../../../packages/extension/src/approval/messaging.js',
        );

        await expect(messaging.resolveApproval('expired-request', { approved: true }))
            .rejects.toMatchObject({
                name: 'ApprovalInterruptedError',
                message: 'This approval was interrupted. Return to the site and try again.',
            });
    });

    it('normalizes a missing fetch after the background restarts', async () => {
        chrome.runtime.sendMessage.mockImplementation((_message, respond) => {
            respond({
                ok: false,
                error: {
                    name: 'ApprovalNotFoundError',
                    message: 'approval.fetch: unknown id "expired-request"',
                },
            });
        });
        const messaging = await vi.importActual(
            '../../../packages/extension/src/approval/messaging.js',
        );

        await expect(messaging.fetchApproval('expired-request'))
            .rejects.toMatchObject({
                name: 'ApprovalInterruptedError',
                message: 'This approval was interrupted. Return to the site and try again.',
            });
    });

    it.each([
        'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received',
        'The message port closed before a response was received.',
    ])('turns a lost runtime response into an interrupted approval: %s', async (message) => {
        chrome.runtime.sendMessage.mockImplementation((_request, respond) => {
            chrome.runtime.lastError = { message };
            respond(undefined);
            chrome.runtime.lastError = undefined;
        });
        const messaging = await vi.importActual(
            '../../../packages/extension/src/approval/messaging.js',
        );

        await expect(messaging.resolveApproval('lost-request', { approved: true }))
            .rejects.toMatchObject({
                name: 'ApprovalInterruptedError',
                message: 'This approval was interrupted. Return to the site and try again.',
            });
    });
});
