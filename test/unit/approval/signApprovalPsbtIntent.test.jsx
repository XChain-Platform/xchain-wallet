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
import { userEvent } from '../../helpers/userEvent.js';

vi.mock('../../../packages/extension/src/approval/messaging.js', () => ({
    fetchApproval: vi.fn(async () => null),
    listWallets: async () => [{ id: 'wallet-1', name: 'Wallet 1' }],
    getSettings: vi.fn(async () => ({})),
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
    resolveApproval: vi.fn(async () => ({ approved: true })),
    getAddressBalances: async () => { throw new Error('not used by signPsbt'); },
    getTokenInfo: async () => { throw new Error('not used by signPsbt'); },
    requoteNativeFee: vi.fn(async () => ({ feeDestination: 'bcrt1qfeedestination' })),
    preflight: vi.fn(async () => ({ verdict: 'pass', findings: [], unverified: [] })),
    describeAction: vi.fn(async () => { throw new Error('not used by signPsbt'); }),
    parseCoSign: async () => { throw new Error('not used by signPsbt'); },
}));

vi.stubGlobal('React', React);

const { SignApproval } = await import(
    '../../../packages/extension/src/approval/kinds/SignApproval.jsx'
);
const { Router } = await import('../../../packages/extension/src/approval/Router.jsx');
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
    messaging.fetchApproval.mockReset();
    messaging.fetchApproval.mockResolvedValue(null);
    messaging.getSettings.mockReset();
    messaging.getSettings.mockResolvedValue({});
    messaging.describeAction.mockReset();
    messaging.describeAction.mockRejectedValue(new Error('not used by signPsbt'));
    messaging.resolveApproval.mockClear();
    messaging.parsePsbt.mockReset();
    messaging.parsePsbt.mockResolvedValue(DEFAULT_PARSED_PSBT);
    messaging.requoteNativeFee.mockReset();
    messaging.requoteNativeFee.mockResolvedValue({ feeDestination: 'bcrt1qfeedestination' });
    messaging.preflight.mockReset();
    messaging.preflight.mockResolvedValue({ verdict: 'pass', findings: [], unverified: [] });
});

describe('SignApproval signPsbt intent', () => {
    it('matches every decoded input, output, and total exactly', async () => {
        const recipientA = 'bcrt1qrecipientaaaaaaaaaaaaaaaaaaaaaaaaaa';
        const recipientB = 'bcrt1qrecipientbbbbbbbbbbbbbbbbbbbbbbbbbb';
        messaging.parsePsbt.mockResolvedValue({
            decomposed: {
                inputs: [
                    { address: 'bcrt1qownaddressownaddress', value: 150000 },
                    { address: null, value: 50000 },
                ],
                outputs: [
                    { address: recipientA, value: 120000 },
                    { address: recipientB, value: 20000 },
                    { address: 'bcrt1qownaddressownaddress', value: 55000 },
                ],
            },
            action: null,
            actionDecodeReason: 'NO_OP_RETURN',
        });

        render(
            <SignApproval
                id="exact-transaction"
                kind="signPsbt"
                payload={{
                    chainId: 'bitcoin-regtest',
                    payload: { psbtHex: '70736274ff01020304' },
                }}
                onReject={() => {}}
            />,
        );

        await screen.findByText('Change (back to you)');
        const inputs = screen.getAllByTestId('psbt-input');
        const outputs = screen.getAllByTestId('psbt-output');
        expect(inputs.map((row) => row.textContent)).toEqual([
            'Your addressbcrt1qownaddressownaddress150,000 sats',
            'Unknown input(unknown source script)50,000 sats',
        ]);
        expect(outputs.map((row) => row.textContent)).toEqual([
            `Recipient${recipientA}120,000 sats`,
            `Recipient${recipientB}20,000 sats`,
            'Change (back to you)bcrt1qownaddressownaddress55,000 sats',
        ]);

        const panel = screen.getByTestId('psbt-intent-panel');
        const totals = Object.fromEntries(
            [...panel.querySelectorAll('dt')].map((label) => [
                label.textContent,
                label.nextElementSibling.textContent,
            ]),
        );
        expect(totals).toEqual({
            'Leaving this wallet': '140,000 sats',
            'Total in': '200,000 sats',
            'Total out': '195,000 sats',
            'Network fee': '5,000 sats',
        });
    });

    it('never displays a missing decoded amount as zero', async () => {
        messaging.parsePsbt.mockResolvedValue({
            decomposed: {
                inputs: [{ address: 'bcrt1qownaddressownaddress', value: 1000 }],
                outputs: [{ address: 'bcrt1qincompleteoutput' }],
            },
            action: null,
            actionDecodeReason: 'NO_OP_RETURN',
        });

        render(
            <SignApproval
                id="incomplete-transaction"
                kind="signPsbt"
                payload={{
                    chainId: 'bitcoin-regtest',
                    payload: { psbtHex: '70736274ff05060708' },
                }}
                onReject={() => {}}
            />,
        );

        const output = (await screen.findAllByTestId('psbt-output'))[0];
        expect(output.textContent).toBe('Recipientbcrt1qincompleteoutputamount unknown');
        const panel = screen.getByTestId('psbt-intent-panel');
        const totals = Object.fromEntries(
            [...panel.querySelectorAll('dt')].map((label) => [
                label.textContent,
                label.nextElementSibling.textContent,
            ]),
        );
        expect(totals).toMatchObject({
            'Leaving this wallet': 'unavailable',
            'Total out': 'unavailable',
            'Network fee': 'unavailable',
        });
    });

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

        await waitFor(() => expect(messaging.parsePsbt.mock.calls.length).toBeGreaterThanOrEqual(2));
        const actionIntent = await screen.findByTestId('psbt-action-intent');
        const panel = await screen.findByTestId('psbt-intent-panel');
        expect(actionIntent.textContent).toBe('Carries an XChain Mint action');
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
        messaging.preflight.mockResolvedValue({
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

    // The handler refuses an approved sign-in with no address, so the window
    // must return the one the user picked from the offered list.
    it('sign-in resolves the picked address and its chain', async () => {
        const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {});
        messaging.resolveApproval.mockClear();
        render(
            <SignApproval
                id="signin-pick"
                kind="signIn"
                payload={{
                    origin: 'https://dapp.test',
                    payload: {
                        appId: 'dapp.test',
                        nonce: 'n1',
                        addresses: [
                            { address: 'bcrt1qfirstfirstfirst', chainId: 'bitcoin-regtest' },
                            { address: 'bcrt1qsecondsecondsecond', chainId: 'bitcoin-regtest' },
                        ],
                    },
                }}
                onReject={() => {}}
            />,
        );
        const second = await screen.findByText('bcrt1qsecondsecondsecond');
        fireEvent.click(second.closest('label').querySelector('input[type="radio"]'));
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' }).disabled).toBe(false));
        const approve = screen.getByRole('button', { name: 'Sign in' });
        approve.focus();
        fireEvent.click(approve);
        await waitFor(() => expect(messaging.resolveApproval).toHaveBeenCalledTimes(1));
        expect(messaging.resolveApproval).toHaveBeenCalledWith('signin-pick', {
            approved: true,
            walletId: 'wallet-1',
            password: 'pw',
            address: 'bcrt1qsecondsecondsecond',
            chainId: 'bitcoin-regtest',
        });
        closeSpy.mockRestore();
    });

    it('sign-in with no offered address cannot be approved', async () => {
        render(
            <SignApproval
                id="signin-none"
                kind="signIn"
                payload={{ origin: 'https://dapp.test', payload: { appId: 'dapp.test', nonce: 'n1' } }}
                onReject={() => {}}
            />,
        );
        expect(await screen.findByText(/no address it may sign in with/i)).toBeTruthy();
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
        expect(screen.getByRole('button', { name: 'Sign in' }).disabled).toBe(true);
    });
});

describe('approval window keyboard controls', () => {
    function renderActionApproval() {
        window.history.replaceState({}, '', '/approval.html?id=keyboard-request');
        messaging.fetchApproval.mockResolvedValueOnce({
            id: 'keyboard-request',
            kind: 'signAction',
            payload: {
                origin: 'https://dapp.test',
                chainId: 'bitcoin-regtest',
                action: 'MINT',
                payload: { TICK: 'JDOG', QUANTITY: '1' },
            },
        });
        messaging.getSettings.mockResolvedValueOnce({ developerMode: true });
        messaging.describeAction.mockResolvedValueOnce({
            summary: 'Mint 1 JDOG',
            details: [{ label: 'Ticker', value: 'JDOG' }],
            warnings: [],
        });
        return render(<Router />);
    }

    it('starts on Reject and requires deliberate keyboard focus before approval', async () => {
        const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {});
        const user = userEvent.setup();
        renderActionApproval();

        const reject = await screen.findByRole('button', { name: 'Reject' });
        const approve = screen.getByRole('button', { name: 'Approve' });
        const details = await screen.findByText('Details (1)');
        const rawDetails = await screen.findByText('Developer · raw view');
        await waitFor(() => expect(document.activeElement).toBe(reject));

        await user.keyboard('{Enter}');
        await waitFor(() => expect(messaging.resolveApproval).toHaveBeenCalledWith(
            'keyboard-request',
            { approved: false },
        ));
        messaging.resolveApproval.mockClear();

        await user.tab();
        expect(document.activeElement).toBe(details);
        await user.tab();
        expect(document.activeElement).toBe(rawDetails);
        await user.tab();
        const password = screen.getByLabelText('Password');
        expect(document.activeElement).toBe(password);
        await user.keyboard('secret{Enter}');
        expect(password).toHaveValue('secret');
        expect(messaging.resolveApproval).not.toHaveBeenCalled();

        await user.tab();
        expect(document.activeElement).toBe(screen.getByRole('checkbox', {
            name: /Always allow this site/i,
        }));
        await user.tab();
        expect(document.activeElement).toBe(reject);
        await user.tab();
        expect(document.activeElement).toBe(approve);
        await user.keyboard('{Enter}');

        await waitFor(() => expect(messaging.resolveApproval).toHaveBeenCalledWith(
            'keyboard-request',
            expect.objectContaining({ approved: true, password: 'secret' }),
        ));
        closeSpy.mockRestore();
    });

    it('rejects from Escape anywhere in the approval window', async () => {
        const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {});
        const user = userEvent.setup();
        renderActionApproval();

        await screen.findByRole('button', { name: 'Reject' });
        await user.keyboard('{Escape}');

        await waitFor(() => expect(messaging.resolveApproval).toHaveBeenCalledWith(
            'keyboard-request',
            { approved: false },
        ));
        closeSpy.mockRestore();
    });
});
