// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// @vitest-environment jsdom

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../packages/core/src/shared/approval/index.js', () => ({
    listWallets: async () => [{ id: 'wallet-1', name: 'Wallet 1' }],
    getSettings: async () => ({ walletMode: 'full' }),
    getAddressesByChain: async () => ({
        'bitcoin-regtest': [{ address: 'bcrt1qloginaddress', source: 'software' }],
    }),
    getAddressBalances: async () => { throw new Error('not used'); },
    getTokenInfo: async () => null,
    parsePsbt: async () => { throw new Error('not used'); },
    parseCoSign: async () => { throw new Error('not used'); },
    requoteNativeFee: async () => null,
    resolveApproval: vi.fn(async () => ({ approved: true })),
    describeAction: async () => null,
    preflight: async () => ({ verdict: 'pass', findings: [], unverified: [] }),
}));

vi.stubGlobal('React', React);

const { SignApproval } = await import(
    '../../../packages/core/src/shared/approval/SignApproval.jsx'
);
const { ConnectApproval } = await import(
    '../../../packages/core/src/shared/approval/ConnectApproval.jsx'
);
const { resolveApproval } = await import(
    '../../../packages/core/src/shared/approval/index.js'
);

const loginPayload = {
    origin: 'https://site.example',
    chainId: 'bitcoin-regtest',
    linkRequest: {
        method: 'login',
        return: 'https://site.example/return',
    },
    payload: {
        appId: 'site.example',
        nonce: 'nonce-1',
        addresses: [{ address: 'bcrt1qloginaddress', chainId: 'bitcoin-regtest' }],
    },
};

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('login approval copy', () => {
    it('uses the product login title, picker label, headline, and Approve verb', async () => {
        render(
            <SignApproval
                id="login-copy"
                kind="signIn"
                payload={loginPayload}
                onReject={() => {}}
            />,
        );

        expect(screen.getAllByText('Login with XChain').length).toBeGreaterThan(0);
        expect(await screen.findByText('Log in to site.example')).toBeInTheDocument();
        expect(await screen.findByRole('button', { name: 'Log in as: bcrt1qloginaddress' }))
            .toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Sign In' })).toBeNull();
    });
});

describe('link approval identity copy', () => {
    it('anchors login identity to the answer origin and warns for callback-only login', async () => {
        render(
            <SignApproval
                id="link-login-copy"
                kind="signIn"
                payload={{
                    ...loginPayload,
                    origin: 'https://untrusted-label.example',
                    linkRequest: {
                        method: 'login',
                        callback: 'https://bücher.example/wallet/callback',
                        app: { name: 'Example app' },
                    },
                }}
                onReject={() => {}}
            />,
        );

        expect(await screen.findByText('Log in to xn--bcher-kva.example')).toBeInTheDocument();
        expect(screen.getByTestId('link-answer-origin')).toHaveTextContent(
            'Opened from a link. The answer goes to https://xn--bcher-kva.example',
        );
        expect(screen.getByTestId('link-answer-origin')).toHaveTextContent(
            'Site-provided name: Example app',
        );
        expect(screen.getByTestId('another-device-login')).toHaveTextContent(
            'You are logging in on another device at https://xn--bcher-kva.example',
        );
        expect(screen.queryByText(/untrusted-label\.example/)).toBeNull();
    });

    it('does not show the another-device warning when a browser return is present', async () => {
        render(
            <SignApproval
                id="link-login-return"
                kind="signIn"
                payload={{
                    ...loginPayload,
                    linkRequest: {
                        method: 'login',
                        return: 'https://site.example/return',
                        callback: 'https://site.example/wallet/callback',
                    },
                }}
                onReject={() => {}}
            />,
        );

        expect(await screen.findByTestId('link-answer-origin')).toBeInTheDocument();
        expect(screen.queryByTestId('another-device-login')).toBeNull();
    });

    it('fails closed when link targets name different origins', async () => {
        render(
            <SignApproval
                id="link-login-mismatch"
                kind="signIn"
                payload={{
                    ...loginPayload,
                    origin: 'https://untrusted-label.example',
                    linkRequest: {
                        method: 'login',
                        return: 'https://site.example/return',
                        callback: 'https://api.example/wallet/callback',
                    },
                }}
                onReject={() => {}}
            />,
        );

        const password = await screen.findByLabelText('Password');
        fireEvent.change(password, { target: { value: 'correct horse battery staple' } });
        fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

        expect(await screen.findByTestId('confirm-blocked')).toHaveTextContent(
            "This request names different sites and can't be approved.",
        );
        expect(resolveApproval).not.toHaveBeenCalled();
        expect(screen.queryByTestId('link-answer-origin')).toBeNull();
        expect(screen.queryByTestId('another-device-login')).toBeNull();
        expect(screen.queryByText(/untrusted-label\.example/)).toBeNull();
    });

    it('uses the answer origin as the Connect card identity', () => {
        render(
            <ConnectApproval
                id="link-connect-copy"
                payload={{
                    origin: 'https://untrusted-label.example',
                    requestedChains: ['bitcoin-regtest'],
                    accountOptions: [{ id: 'account-1', name: 'Primary' }],
                    linkRequest: {
                        method: 'login',
                        return: 'https://site.example/return',
                        app: { name: 'Example app' },
                    },
                }}
                onReject={() => {}}
            />,
        );

        const [card] = screen.getAllByLabelText(
            'Opened from a link. The answer goes to https://site.example',
        );
        expect(card).toHaveTextContent('https://site.example');
        expect(card).toHaveTextContent('Site-provided name: Example app');
        expect(card).not.toHaveTextContent('untrusted-label.example');
    });
});
