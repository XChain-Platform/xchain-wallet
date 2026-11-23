// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// @vitest-environment jsdom

import React from 'react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../packages/core/src/shared/hooks/useFeeFiat.js', () => ({
    useFeeFiat: () => ({
        formatNativeFee: (amount) => (amount === '0.000015' ? '~$1.50' : null),
    }),
}));

vi.mock('../../../packages/core/src/shared/approval/index.js', () => ({
    listWallets: async () => [{ id: 'wallet-1', name: 'Wallet 1' }],
    getSettings: async () => ({ walletMode: 'full' }),
    getAddressesByChain: async () => ({
        'bitcoin-mainnet': [{ address: 'bc1qsourceaddress' }],
    }),
    getAddressBalances: async () => ({
        native: { tick: 'BTC', divisibility: 8, quantity: '1000000' },
        tokens: [{ tick: 'ABC', divisibility: 0, quantity: '10000' }],
    }),
    getTokenInfo: async () => null,
    parsePsbt: async () => { throw new Error('not used'); },
    parseCoSign: async () => { throw new Error('not used'); },
    requoteNativeFee: async () => null,
    resolveApproval: vi.fn(async () => ({ approved: true })),
    describeAction: vi.fn(async () => ({
        summary: 'Send 1000 ABC to bc1qrecipientaddress.',
        details: [
            { label: 'Amount', value: '1000' },
            { label: 'Token', value: 'ABC' },
            { label: 'To', value: 'bc1qrecipientaddress' },
            { label: 'Memo', value: 'Invoice 42' },
        ],
        warnings: [],
    })),
    preflight: vi.fn(async () => ({
        verdict: 'fail',
        findings: [{
            code: 'BALANCE_INSUFFICIENT',
            severity: 'error',
            overridable: false,
            message: 'The action would exceed the available balance.',
        }],
        unverified: [],
    })),
}));

vi.stubGlobal('React', React);

const { SignApproval } = await import(
    '../../../packages/core/src/shared/approval/SignApproval.jsx'
);

afterAll(() => vi.unstubAllGlobals());
afterEach(cleanup);

describe('SignApproval Confirm Standard', () => {
    it('renders sign-message provenance, signer facts, and the verbatim message without parsed rows', async () => {
        const message = [
            'app.example wants you to sign in with your account:',
            'bc1qsourceaddress',
            '',
            'URI: https://app.example/login',
            'Nonce: 123456',
            'Issued At: 2026-11-16T12:00:00Z',
        ].join('\n');
        render(
            <SignApproval
                id="sign-message-standard"
                kind="signMessage"
                payload={{
                    origin: 'https://app.example',
                    chainId: 'bitcoin-mainnet',
                    payload: { address: 'bc1qsourceaddress', message },
                }}
                onReject={() => {}}
            />,
        );

        const origin = await screen.findByTestId('confirm-request-origin');
        const facts = await screen.findByTestId('confirm-facts');
        expect(origin.nextElementSibling).toBe(facts);
        expect([...facts.querySelectorAll('dt')].map((node) => node.textContent)).toEqual([
            'Signing with',
            'Network',
            'Address',
        ]);
        expect(screen.getByTestId('confirm-signing-wallet')).toHaveTextContent('Wallet 1');
        expect(screen.getByTestId('confirm-network')).toHaveTextContent('Bitcoin');
        expect(screen.getByTestId('confirm-address').querySelector('[title="bc1qsourceaddress"]'))
            .not.toBeNull();

        const shownMessage = screen.getByTestId('confirm-message-text');
        expect(shownMessage.tagName).toBe('P');
        expect(shownMessage.textContent).toBe(message);
        expect([...facts.querySelectorAll('dt')].map((node) => node.textContent))
            .not.toEqual(expect.arrayContaining(['URI', 'Nonce', 'Issued at']));
    });

    it('uses the shared body: status first, the fee as a row, the warning before the password, buttons docked', async () => {
        render(
            <SignApproval
                id="confirm-standard"
                kind="signAction"
                payload={{
                    origin: 'https://app.example/request',
                    chainId: 'bitcoin-mainnet',
                    action: 'SEND',
                    actionString: 'SEND|1|ABC|1000|bc1qrecipientaddress',
                    payload: {
                        from: { address: 'bc1qsourceaddress' },
                        TICK: 'ABC',
                        AMOUNT: '1000',
                        DESTINATION: 'bc1qrecipientaddress',
                        requested: { fee: 1500 },
                    },
                }}
                onReject={() => {}}
            />,
        );

        expect(await screen.findByTestId('confirm-sentence'))
            .toHaveTextContent('Send 1,000 ABC to the address below for app.example');
        expect(screen.getByTestId('confirm-address').querySelector('[title="bc1qrecipientaddress"]'))
            .not.toBeNull();
        expect(screen.getByTestId('confirm-facts').querySelector('dt')).toHaveTextContent('To');
        expect(screen.getByTestId('confirm-facts').querySelector('dd'))
            .toBe(screen.getByTestId('confirm-address'));
        expect(screen.queryByTestId('confirm-total-main')).toBeNull();
        expect(screen.getByTestId('confirm-fee-network')).toHaveTextContent('0.000015 BTC');
        expect(screen.getByTestId('confirm-fee-network').closest('[data-testid="confirm-facts"]')).not.toBeNull();
        expect(screen.getByTestId('confirm-network')).toHaveTextContent('Bitcoin');
        expect(screen.getByTestId('confirm-facts')).toHaveTextContent('Invoice 42');
        expect(await screen.findByText('Balance after (ABC)')).toBeInTheDocument();
        expect(screen.getByText('9,000 ABC')).toBeInTheDocument();
        expect(screen.queryByTestId('preflight-panel')).toBeNull();
        expect(document.querySelector('details')).toBeNull();
        expect(screen.queryByText('Requesting site')).toBeNull();

        // The status notice is first on the page.
        // The notice first renders as the info "checking" state and turns
        // danger when the network check's verdict lands, so wait for the
        // verdict instead of reading whichever state renders first.
        await waitFor(
            () => expect(screen.getByTestId('confirm-status').getAttribute('data-tone')).toBe('danger'),
            { timeout: 10_000 },
        );
        const status = screen.getByTestId('confirm-status');
        expect(screen.getByTestId('confirm-modal').firstElementChild).toBe(screen.getByTestId('confirm-status-slot'));
        const password = screen.getByLabelText('Password');
        const buttons = screen.getByTestId('confirm-buttons');
        expect(status.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(password.compareDocumentPosition(buttons) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.getByTestId('confirm-reject')).toHaveTextContent('Reject');
        expect(screen.getByTestId('confirm-approve')).toHaveTextContent('Approve');
        // A blocking finding disables Approve before password validation can run.
        expect(screen.getByTestId('confirm-approve')).toBeDisabled();
        fireEvent.click(screen.getByTestId('confirm-approve'));
        expect(screen.queryByTestId('confirm-blocked')).toBeNull();
    });
});
