// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// @vitest-environment jsdom

// Unit: SignApproval's signPsbt intent decode (§21.2 / §48). The output
// set is decoded independently of the raw hex the dApp supplied (via the
// same psbt.parse host route the in-wallet sign form uses) so the user
// sees recipients, change and any carried XChain action before entering
// a password. Mounted for real; the mock stands in for the extension's
// message-passing bridge only.

import React from 'react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../packages/extension/src/approval/messaging.js', () => ({
    listWallets: async () => [{ id: 'wallet-1', name: 'Wallet 1' }],
    getSettings: async () => ({}),
    getAddressesByChain: async () => ({
        'bitcoin-regtest': [{ address: 'bcrt1qownaddressownaddress' }],
    }),
    parsePsbt: vi.fn(async () => ({
        decomposed: {
            inputs: [{ address: 'bcrt1qownaddressownaddress', value: 150000 }],
            outputs: [
                { address: 'bcrt1qrecipientrecipient', value: 100000 },
                { address: 'bcrt1qownaddressownaddress', value: 49500 },
            ],
        },
        action: { actionString: 'MINT|1|JDOG|1', action: 'MINT', version: 1 },
        actionDecodeReason: null,
    })),
    resolveApproval: async () => ({ approved: true }),
    getAddressBalances: async () => { throw new Error('not used by signPsbt'); },
    getTokenInfo: async () => { throw new Error('not used by signPsbt'); },
    requoteNativeFee: vi.fn(async () => ({ feeDestination: 'bcrt1qfeedestination' })),
    preflight: vi.fn(async () => ({ verdict: 'pass', findings: [], unverified: [] })),
    describeAction: async () => { throw new Error('not used by signPsbt'); },
    parseCoSign: async () => { throw new Error('not used by signPsbt'); },
}));

vi.stubGlobal('React', React);

const { SignApproval } = await import(
    '../../../packages/extension/src/approval/kinds/SignApproval.jsx'
);
const messaging = await import('../../../packages/extension/src/approval/messaging.js');

const DEFAULT_PARSED_PSBT = {
    decomposed: {
        inputs: [{ address: 'bcrt1qownaddressownaddress', value: 150000 }],
        outputs: [
            { address: 'bcrt1qrecipientrecipient', value: 100000 },
            { address: 'bcrt1qownaddressownaddress', value: 49500 },
        ],
    },
    action: { actionString: 'MINT|1|JDOG|1', action: 'MINT', version: 1 },
    actionDecodeReason: null,
};

afterAll(() => vi.unstubAllGlobals());

afterEach(() => {
    cleanup();
    messaging.parsePsbt.mockReset();
    messaging.parsePsbt.mockResolvedValue(DEFAULT_PARSED_PSBT);
    messaging.requoteNativeFee.mockReset();
    messaging.requoteNativeFee.mockResolvedValue({ feeDestination: 'bcrt1qfeedestination' });
    messaging.preflight.mockReset();
    messaging.preflight.mockResolvedValue({ verdict: 'pass', findings: [], unverified: [] });
});

describe('SignApproval signPsbt intent', () => {
    it('renders the intent decoded from the requested PSBT', async () => {
        render(
            <SignApproval
                id="request-1"
                kind="signPsbt"
                payload={{
                    chainId: 'bitcoin-regtest',
                    payload: { psbtHex: 'deadbeefcafe' },
                }}
                onReject={() => {}}
            />,
        );

        const panel = await screen.findByTestId('psbt-intent-panel');
        expect(screen.getByTestId('psbt-action-intent').textContent)
            .toBe('Carries an XChain MINT action (v1)');
        expect(panel.textContent).toContain('Recipient');
        expect(panel.textContent).toContain('100,000 sats');
        expect(panel.textContent).toContain('Change (back to you)');
        expect(panel.textContent).toContain('49,500 sats');
        expect(panel.textContent).toContain('Your address');
        expect(messaging.parsePsbt).toHaveBeenCalledWith({
            chainId: 'bitcoin-regtest',
            psbtHex: 'deadbeefcafe',
        });
    });

    it('runs and displays preflight for the action decoded from the PSBT', async () => {
        render(
            <SignApproval
                id="request-2"
                kind="signPsbt"
                payload={{
                    chainId: 'bitcoin-regtest',
                    payload: { psbtHex: 'deadbeefcafe' },
                }}
                onReject={() => {}}
            />,
        );

        await screen.findByTestId('preflight-panel');
        expect(messaging.preflight).toHaveBeenCalledWith({
            chainId: 'bitcoin-regtest',
            actionString: 'MINT|1|JDOG|1',
            source: 'bcrt1qownaddressownaddress',
            mode: 'report',
        });
    });

    it('blocks approval when PSBT action preflight has a hard failure', async () => {
        messaging.preflight.mockResolvedValueOnce({
            verdict: 'fail',
            findings: [{
                code: 'BALANCE_INSUFFICIENT',
                severity: 'error',
                overridable: false,
                message: 'The action would exceed the available balance.',
            }],
            unverified: [],
        });
        render(
            <SignApproval
                id="request-3"
                kind="signPsbt"
                payload={{
                    chainId: 'bitcoin-regtest',
                    payload: { psbtHex: 'deadbeefcafe' },
                }}
                onReject={() => {}}
            />,
        );

        expect(await screen.findByText('The action would exceed the available balance.'))
            .toBeTruthy();
        expect(screen.getByRole('button', { name: /Approve/i }).disabled).toBe(true);
    });

    it('uses input zero as the sender when another input belongs to this wallet', async () => {
        messaging.parsePsbt.mockResolvedValue({
            decomposed: {
                inputs: [
                    { address: 'bcrt1qotherparty', value: 100000 },
                    { address: 'bcrt1qownaddressownaddress', value: 50000 },
                ],
                outputs: [{ address: 'bcrt1qrecipientrecipient', value: 149500 }],
            },
            action: { actionString: 'MINT|1|JDOG|1', action: 'MINT', version: 1 },
            actionDecodeReason: null,
        });
        render(
            <SignApproval
                id="request-4"
                kind="signPsbt"
                payload={{
                    chainId: 'bitcoin-regtest',
                    payload: { psbtHex: 'deadbeefcafe' },
                }}
                onReject={() => {}}
            />,
        );

        await screen.findByTestId('preflight-panel');
        expect(messaging.preflight).toHaveBeenCalledWith({
            chainId: 'bitcoin-regtest',
            actionString: 'MINT|1|JDOG|1',
            source: 'bcrt1qotherparty',
            mode: 'report',
        });
    });

    it('preflights a PSBT with a native fee output in native mode', async () => {
        messaging.parsePsbt.mockResolvedValue({
            decomposed: {
                inputs: [{ address: 'bcrt1qownaddressownaddress', value: 150000 }],
                outputs: [
                    { address: 'bcrt1qfeedestination', value: 5000 },
                    { address: 'bcrt1qownaddressownaddress', value: 144500 },
                ],
            },
            action: { actionString: 'MINT|1|JDOG|1', action: 'MINT', version: 1 },
            actionDecodeReason: null,
        });
        render(
            <SignApproval
                id="request-5"
                kind="signPsbt"
                payload={{
                    chainId: 'bitcoin-regtest',
                    payload: { psbtHex: 'deadbeefcafe' },
                }}
                onReject={() => {}}
            />,
        );

        await screen.findByTestId('preflight-panel');
        expect(messaging.preflight).toHaveBeenCalledWith({
            chainId: 'bitcoin-regtest',
            actionString: 'MINT|1|JDOG|1',
            source: 'bcrt1qownaddressownaddress',
            feeMode: 'native',
            mode: 'report',
        });
    });

    it('makes a dry-run failure overridable when input zero has no address', async () => {
        messaging.parsePsbt.mockResolvedValue({
            decomposed: {
                inputs: [{ address: null, value: 150000 }],
                outputs: [{ address: 'bcrt1qrecipientrecipient', value: 149500 }],
            },
            action: { actionString: 'MINT|1|JDOG|1', action: 'MINT', version: 1 },
            actionDecodeReason: null,
        });
        messaging.preflight.mockResolvedValue({
            verdict: 'fail',
            findings: [{
                code: 'BALANCE_INSUFFICIENT',
                severity: 'error',
                overridable: false,
                message: 'The action would exceed the available balance.',
                data: { status: 'invalid: insufficient funds' },
            }],
            unverified: [],
        });
        render(
            <SignApproval
                id="request-6"
                kind="signPsbt"
                payload={{
                    chainId: 'bitcoin-regtest',
                    payload: { psbtHex: 'deadbeefcafe' },
                }}
                onReject={() => {}}
            />,
        );

        const acknowledgment = await screen.findByTestId('ack-BALANCE_INSUFFICIENT');
        fireEvent.click(acknowledgment);
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /Approve/i }).disabled).toBe(false);
        });
        expect(messaging.preflight).toHaveBeenCalledWith({
            chainId: 'bitcoin-regtest',
            actionString: 'MINT|1|JDOG|1',
            mode: 'report',
        });
    });
});

describe('SignApproval untrusted text', () => {
    it('neutralizes controls in a message while warning that the original is signed', async () => {
        render(
            <SignApproval
                id="message-controls"
                kind="signMessage"
                payload={{
                    origin: 'https://dapp.test',
                    payload: { message: 'Pay alice\u202Etxt\u200B\u2028today' },
                }}
                onReject={() => {}}
            />,
        );

        expect(await screen.findByText('Pay alice␦txt today')).toBeTruthy();
        expect(screen.queryByText('Pay alice\u202Etxt\u200B\u2028today')).toBeNull();
        expect(screen.getByText(/original message text/i)).toBeTruthy();
    });

    it('neutralizes controls in sign-in identifiers', async () => {
        render(
            <SignApproval
                id="signin-controls"
                kind="signIn"
                payload={{
                    origin: 'https://dapp.test',
                    payload: {
                        appId: 'trusted.example\u202Emoc.live',
                        nonce: 'one\u200Btime\u2028code',
                    },
                }}
                onReject={() => {}}
            />,
        );

        expect(await screen.findByText('trusted.example␦moc.live')).toBeTruthy();
        expect(screen.getByText('onetime code')).toBeTruthy();
        expect(screen.getAllByText(/original sign-in text/i)).toHaveLength(2);
    });
});
