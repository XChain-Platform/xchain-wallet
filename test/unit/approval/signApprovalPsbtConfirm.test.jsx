// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// @vitest-environment jsdom

import React from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({
    parsed: null,
    descriptions: {},
    report: { verdict: 'pass', findings: [], unverified: [] },
}));

vi.mock('../../../packages/core/src/shared/hooks/useFeeFiat.js', () => ({
    useFeeFiat: () => ({ formatNativeFee: () => null }),
}));

vi.mock('../../../packages/extension/src/approval/messaging.js', () => ({
    listWallets: async () => [{ id: 'wallet-1', name: 'Wallet 1' }],
    getSettings: async () => ({ walletMode: 'full' }),
    getAddressesByChain: async () => ({
        'bitcoin-mainnet': [
            { address: 'bc1qsourceaddress' },
            { address: 'bc1qchangeaddress' },
        ],
    }),
    getAddressBalances: async () => ({
        native: { tick: 'BTC', divisibility: 8, quantity: '5000000' },
        tokens: [],
    }),
    getTokenInfo: async () => null,
    parsePsbt: async () => state.parsed,
    parseCoSign: async () => { throw new Error('not used'); },
    requoteNativeFee: async () => null,
    resolveApproval: vi.fn(async () => ({ approved: true })),
    describeAction: vi.fn(async ({ action }) => state.descriptions[action] || null),
    preflight: vi.fn(async () => state.report),
}));

vi.stubGlobal('React', React);

const { SignApproval } = await import(
    '../../../packages/extension/src/approval/kinds/SignApproval.jsx'
);

function psbtPayload() {
    return {
        origin: 'https://app.example/request',
        chainId: 'bitcoin-mainnet',
        payload: {
            psbtHex: '70736274ff00',
            signingPaths: [{ inputIndex: 0, address: 'bc1qsourceaddress' }],
        },
    };
}

function transaction(outputs) {
    return {
        inputs: [{ address: 'bc1qsourceaddress', value: 2_000_000 }],
        outputs,
    };
}

function renderApproval() {
    return render(
        <SignApproval
            id="psbt-confirm"
            kind="signPsbt"
            payload={psbtPayload()}
            onReject={() => {}}
        />,
    );
}

beforeEach(() => {
    state.parsed = null;
    state.descriptions = {};
    state.report = { verdict: 'pass', findings: [], unverified: [] };
});

afterEach(cleanup);
afterAll(() => vi.unstubAllGlobals());

describe('SignApproval PSBT Confirm Standard', () => {
    it('renders a decoded send with the requesting site above the shared confirm', async () => {
        state.parsed = {
            decomposed: transaction([
                { address: 'bc1qrecipientaddress', value: 1_000_000 },
                { address: 'bc1qchangeaddress', value: 990_000 },
            ]),
            action: {
                actionString: 'SEND|1|ABC|1000|bc1qrecipientaddress',
                action: 'SEND',
                version: 1,
                params: { TICK: 'ABC', AMOUNT: '1000', DESTINATION: 'bc1qrecipientaddress' },
            },
            actionDecodeReason: null,
        };
        state.descriptions.SEND = {
            summary: 'Send 1000 ABC to bc1qrecipientaddress.',
            details: [
                { label: 'Amount', value: '1000' },
                { label: 'Token', value: 'ABC' },
                { label: 'To', value: 'bc1qrecipientaddress' },
                { label: 'Memo', value: 'Invoice 42' },
            ],
            warnings: [],
        };

        renderApproval();

        await waitFor(() => expect(screen.getByTestId('confirm-sentence'))
            .toHaveTextContent('Send 1,000 ABC to'));
        expect(screen.getByTestId('confirm-address').querySelector('[title="bc1qrecipientaddress"]'))
            .not.toBeNull();
        expect(screen.getByTestId('confirm-facts')).toHaveTextContent('Invoice 42');
        expect(screen.getByTestId('confirm-fee-network')).toHaveTextContent('0.0001 BTC');
        const origin = screen.getByTestId('confirm-request-origin');
        expect(origin.nextElementSibling).toBe(screen.getByTestId('confirm-modal'));
        expect(screen.queryByTestId('psbt-input')).toBeNull();
        expect(screen.queryByTestId('psbt-output')).toBeNull();
    });

    it('renders a decoded batch as the batch confirm kind', async () => {
        state.parsed = {
            decomposed: transaction([
                { address: 'bc1qchangeaddress', value: 1_990_000 },
            ]),
            action: {
                actionString: 'BATCH|1|SEND;MINT',
                action: 'BATCH',
                version: 1,
                params: { ACTIONS: 'SEND;MINT' },
            },
            actionDecodeReason: null,
        };
        state.descriptions.BATCH = {
            summary: 'Run a batch of 2 actions.',
            details: [{ label: 'Actions', value: 'Send, Mint' }],
            warnings: [],
        };

        renderApproval();

        await waitFor(() => expect(screen.getByTestId('confirm-sentence'))
            .toHaveTextContent('Run a batch of 2 actions.'));
        expect(screen.getByTestId('confirm-facts')).toHaveTextContent('Send, Mint');
        expect(screen.getByTestId('confirm-icon').querySelector('svg')).not.toBeNull();
        expect(screen.queryByText(/^Inputs\b/)).toBeNull();
        expect(screen.queryByText(/^Outputs\b/)).toBeNull();
    });

    it('renders a bare coin payment as a send and leaves wallet change out', async () => {
        state.parsed = {
            decomposed: transaction([
                { address: 'bc1qbarepaymentrecipient', value: 1_000_000 },
                { address: 'bc1qchangeaddress', value: 990_000 },
            ]),
            action: null,
            actionDecodeReason: 'NO_OP_RETURN',
        };

        renderApproval();

        await waitFor(() => expect(screen.getByTestId('confirm-sentence'))
            .toHaveTextContent('Send 0.01 BTC to'));
        expect(screen.getByTestId('confirm-address').querySelector('[title="bc1qbarepaymentrecipient"]'))
            .not.toBeNull();
        expect(screen.getByTestId('confirm-facts')).not.toHaveTextContent('bc1qchangeaddress');
        expect(screen.getByTestId('confirm-fee-network')).toHaveTextContent('0.0001 BTC');
    });

    it('refuses an action the decoder cannot explain and never shows green', async () => {
        state.parsed = {
            decomposed: transaction([
                { address: 'bc1qrecipientaddress', value: 1_000_000 },
                { address: 'bc1qchangeaddress', value: 990_000 },
            ]),
            action: null,
            actionDecodeReason: 'UNKNOWN_ACTION',
        };

        renderApproval();

        const status = await screen.findByTestId('confirm-status');
        expect(status).toHaveAttribute('data-tone', 'danger');
        expect(status).toHaveTextContent('could not be read');
        expect(screen.queryByText('Checked: this will go through.')).toBeNull();
        expect(screen.getByTestId('confirm-approve')).not.toBeDisabled();
        fireEvent.click(screen.getByTestId('confirm-approve'));
        expect(await screen.findByTestId('confirm-blocked')).toHaveTextContent('will not sign');
    });
});
