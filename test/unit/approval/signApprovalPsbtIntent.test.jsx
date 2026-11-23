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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { userEvent } from '../../helpers/userEvent.js';

vi.mock('../../../packages/core/src/shared/approval/index.js', () => ({
    fetchApproval: vi.fn(async () => null),
    listWallets: vi.fn(async () => [{ id: 'wallet-1', name: 'Wallet 1' }]),
    getSettings: vi.fn(async () => ({})),
    getAddressesByChain: vi.fn(async () => ({
        'bitcoin-regtest': [{ address: 'bcrt1qownaddressownaddress' }],
    })),
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
    describeAction: vi.fn(async () => ({
        summary: 'Mint 1 JDOG.',
        details: [
            { label: 'Amount', value: '1' },
            { label: 'Token', value: 'JDOG' },
            { label: 'To', value: 'bcrt1qrecipientrecipient' },
        ],
        warnings: [],
    })),
    parseCoSign: async () => { throw new Error('not used by signPsbt'); },
}));
vi.mock('../../../packages/extension/src/approval/messaging.js', async () => (
    import('../../../packages/core/src/shared/approval/index.js')
));

vi.stubGlobal('React', React);

const { SignApproval } = await import(
    '../../../packages/core/src/shared/approval/SignApproval.jsx'
);
const { ConnectApproval } = await import(
    '../../../packages/core/src/shared/approval/ConnectApproval.jsx'
);
const { Router } = await import('../../../packages/extension/src/approval/Router.jsx');
const messaging = await import('../../../packages/core/src/shared/approval/index.js');

const readCss = (relativePath) => readFileSync(join(process.cwd(), relativePath), 'utf8');

function setApprovalViewport() {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    Object.defineProperty(document.documentElement, 'clientWidth', {
        configurable: true,
        value: 360,
    });
    Object.defineProperty(document.documentElement, 'clientHeight', {
        configurable: true,
        value: 600,
    });
}

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
    messaging.listWallets.mockReset();
    messaging.listWallets.mockResolvedValue([{ id: 'wallet-1', name: 'Wallet 1' }]);
    messaging.getAddressesByChain.mockReset();
    messaging.getAddressesByChain.mockResolvedValue({
        'bitcoin-regtest': [{ address: 'bcrt1qownaddressownaddress' }],
    });
    messaging.getSettings.mockReset();
    messaging.getSettings.mockResolvedValue({});
    messaging.describeAction.mockReset();
    messaging.describeAction.mockResolvedValue({
        summary: 'Mint 1 JDOG.',
        details: [
            { label: 'Amount', value: '1' },
            { label: 'Token', value: 'JDOG' },
            { label: 'To', value: 'bcrt1qrecipientrecipient' },
        ],
        warnings: [],
    });
    messaging.resolveApproval.mockClear();
    messaging.parsePsbt.mockReset();
    messaging.parsePsbt.mockResolvedValue(DEFAULT_PARSED_PSBT);
    messaging.requoteNativeFee.mockReset();
    messaging.requoteNativeFee.mockResolvedValue({ feeDestination: 'bcrt1qfeedestination' });
    messaging.preflight.mockReset();
    messaging.preflight.mockResolvedValue({ verdict: 'pass', findings: [], unverified: [] });
});

describe('SignApproval signPsbt intent', () => {
    it('summarizes a many-recipient bare payment without recipient rows or change', async () => {
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

        await waitFor(() => expect(screen.getByTestId('confirm-sentence'))
            .toHaveTextContent('Send 0.0014 BTC to 2 recipients'));
        const facts = screen.getByTestId('confirm-facts');
        expect([...facts.querySelectorAll('dt')].map((node) => node.textContent)).toEqual([
            'Signing with',
            'Network',
            'Network fee',
        ]);
        expect(facts).not.toHaveTextContent(recipientA);
        expect(facts).not.toHaveTextContent(recipientB);
        expect(facts).not.toHaveTextContent('0.0012 BTC');
        expect(facts).not.toHaveTextContent('0.0002 BTC');
        expect(facts).toHaveTextContent('0.00005 BTC');
        expect(facts).not.toHaveTextContent('bcrt1qownaddressownaddress');
        expect(screen.queryByTestId('psbt-input')).toBeNull();
        expect(screen.queryByTestId('psbt-output')).toBeNull();
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

        const status = await screen.findByTestId('confirm-status');
        expect(status).toHaveAttribute('data-tone', 'danger');
        expect(status).toHaveTextContent('cannot explain safely');
        expect(document.body.textContent).not.toContain('0 BTC');
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

        await waitFor(() => expect(screen.getByTestId('confirm-sentence'))
            .toHaveTextContent('Mint 1 JDOG.'));
        const facts = screen.getByTestId('confirm-facts');
        expect(messaging.parsePsbt).toHaveBeenCalledTimes(1);
        expect(facts).toHaveTextContent('bcrt1q');
        expect(facts).toHaveTextContent('0.000005 BTC');
        expect(screen.queryByTestId('psbt-input')).toBeNull();
        expect(screen.queryByTestId('psbt-output')).toBeNull();
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

        await waitFor(() => expect(messaging.preflight).toHaveBeenCalledWith({
            chainId: 'bitcoin-regtest',
            actionString: 'MINT|1|JDOG|1',
            source: 'bcrt1qownaddressownaddress',
            mode: 'report',
        }));
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

        await screen.findByText('The checks found a problem with this action.');
        const status = screen.getByTestId('confirm-status');
        const bullets = [...status.querySelectorAll('[data-notice-list] > li')];
        expect(bullets.map((bullet) => bullet.textContent)).toEqual([
            'The checks found a problem with this action.',
        ]);
        expect(status).not.toHaveTextContent('The action would exceed the available balance.');
        expect(status).not.toHaveTextContent("Approve won't send this while it fails.");
        const approve = screen.getByRole('button', { name: /Approve/i });
        expect(approve.disabled).toBe(true);
        fireEvent.click(approve);
        expect(screen.queryByTestId('confirm-blocked')).toBeNull();
        expect(messaging.resolveApproval).not.toHaveBeenCalled();
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

        await waitFor(() => expect(messaging.preflight).toHaveBeenCalledWith({
            chainId: 'bitcoin-regtest',
            actionString: 'MINT|1|JDOG|1',
            source: 'bcrt1qotherparty',
            mode: 'report',
        }));
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

        await waitFor(() => expect(messaging.preflight).toHaveBeenCalledWith({
            chainId: 'bitcoin-regtest',
            actionString: 'MINT|1|JDOG|1',
            source: 'bcrt1qownaddressownaddress',
            feeMode: 'native',
            mode: 'report',
        }));
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

    it('resolves with the wallet that owns every requested signing path', async () => {
        const signingAddress = 'bcrt1qsecondwalletsigner';
        messaging.listWallets.mockResolvedValue([
            { id: 'wallet-1', name: 'Wallet 1' },
            { id: 'wallet-2', name: 'Wallet 2' },
        ]);
        messaging.getAddressesByChain.mockImplementation(async (walletId) => ({
            'bitcoin-regtest': walletId === 'wallet-2'
                ? [{ address: signingAddress, derivationPath: "m/84'/1'/0'/0/0" }]
                : [{ address: 'bcrt1qfirstwallet' }],
        }));
        messaging.parsePsbt.mockResolvedValue({
            decomposed: {
                inputs: [{ address: signingAddress, value: 150000 }],
                outputs: [{ address: 'bcrt1qrecipientrecipient', value: 149500 }],
            },
            action: null,
            actionDecodeReason: 'NO_OP_RETURN',
        });
        const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {});

        render(
            <SignApproval
                id="wallet-bound-request"
                kind="signPsbt"
                payload={{
                    chainId: 'bitcoin-regtest',
                    payload: {
                        psbtHex: 'deadbeefcafe',
                        signingPaths: [{ inputIndex: 0, address: signingAddress }],
                    },
                }}
                onReject={() => {}}
            />,
        );

        fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'secret' } });
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /Approve/i }).disabled).toBe(false);
        });
        fireEvent.click(screen.getByRole('button', { name: /Approve/i }));

        await waitFor(() => expect(messaging.resolveApproval).toHaveBeenCalledWith(
            'wallet-bound-request',
            expect.objectContaining({ approved: true, walletId: 'wallet-2' }),
        ));
        closeSpy.mockRestore();
    });
});

describe('SignApproval 360x600 layout', () => {
    it('keeps long origin and message details in the body scrollport with both actions docked', async () => {
        setApprovalViewport();
        const origin = `https://${'attacker-controlled-subdomain-'.repeat(12)}trusted.example:65535`;
        const message = `Authorize:${'unbroken-message-segment'.repeat(80)}`;
        const appName = 'UnbrokenDeclaredApplicationName'.repeat(4);
        const view = render(
            <SignApproval
                id="narrow-message"
                kind="signMessage"
                payload={{ origin, appName, payload: { message } }}
                onReject={() => {}}
            />,
        );

        expect(await screen.findByTestId('confirm-sentence')).toHaveTextContent(/for attacker-controlled-subdomain/);
        expect(screen.getByText(message)).toBeTruthy();

        const approvalScreen = view.container.firstElementChild;
        const detailScrollport = approvalScreen.querySelector('main');
        const actionFooter = approvalScreen.querySelector('footer');
        expect(detailScrollport).not.toBeNull();
        expect(detailScrollport).toContainElement(screen.getByText(message));
        expect(actionFooter).not.toBeNull();
        expect(actionFooter).not.toBe(detailScrollport);
        expect(screen.getByTestId('confirm-buttons').querySelectorAll('button')).toHaveLength(2);
        expect(screen.getByRole('button', { name: /Reject/i })).toBeVisible();
        expect(screen.getByRole('button', { name: /Approve/i })).toBeVisible();

        const screenCss = readCss('packages/core/src/ui/Screen.module.css');
        const signCss = readCss('packages/core/src/shared/approval/SignApproval.module.css');
        expect(screenCss).toMatch(/\.screen\s*\{[^}]*height:[^;}]+;[^}]*overflow:\s*hidden/s);
        expect(screenCss).toMatch(/\.body\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;[^}]*overflow-x:\s*hidden/s);
        expect(screenCss).toMatch(/\.footer\s*\{[^}]*flex:\s*0 0 auto/s);
        expect(signCss).toMatch(/\.footer\s*\{[^}]*flex-direction:\s*column;[^}]*min-width:\s*0/s);
    });

    it('keeps a many-recipient transaction to its decoded summary without raw output rows', async () => {
        setApprovalViewport();
        const outputs = Array.from({ length: 24 }, (_, index) => ({
            address: `bcrt1q${String(index).padStart(2, '0')}${'destination'.repeat(16)}`,
            value: index + 1,
        }));
        messaging.parsePsbt.mockResolvedValue({
            decomposed: {
                inputs: [{ address: 'bcrt1qownaddressownaddress', value: 1000000 }],
                outputs,
            },
            action: null,
            actionDecodeReason: 'NO_OP_RETURN',
        });
        const view = render(
            <SignApproval
                id="narrow-outputs"
                kind="signPsbt"
                payload={{
                    chainId: 'bitcoin-regtest',
                    origin: `https://${'long-origin-label-'.repeat(16)}example.test`,
                    payload: { psbtHex: 'deadbeefcafe' },
                }}
                onReject={() => {}}
            />,
        );

        await waitFor(() => expect(screen.getByTestId('confirm-sentence'))
            .toHaveTextContent('24 recipients'));
        const facts = screen.getByTestId('confirm-facts');
        expect([...facts.querySelectorAll('dt')].map((node) => node.textContent)).toEqual([
            'Signing with',
            'Network',
            'Network fee',
        ]);
        expect(facts).not.toHaveTextContent(outputs[0].address);
        expect(facts).not.toHaveTextContent(outputs[23].address);
        expect(screen.queryByTestId('psbt-input')).toBeNull();
        expect(screen.queryByTestId('psbt-output')).toBeNull();

        const detailScrollport = view.container.querySelector('main');
        const actionFooter = view.container.querySelector('footer');
        expect(detailScrollport).toContainElement(facts);
        expect(detailScrollport.nextElementSibling).toBe(actionFooter);
        expect(screen.getByTestId('confirm-buttons').querySelectorAll('button')).toHaveLength(2);

        const approvalCss = readCss('packages/core/src/shared/approval/approval.module.css');
        const signCss = readCss('packages/core/src/shared/approval/SignApproval.module.css');
        expect(approvalCss).toMatch(/\.toggleRow\s*\{[^}]*min-width:\s*0/s);
        expect(approvalCss).toMatch(/\.toggleRow > span:last-child\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere/s);
        expect(signCss).not.toMatch(/\.details(?:Row|Value)/);
    });
});

describe('SignApproval untrusted text', () => {
    it('permanently disables Connect when the request expires', async () => {
        messaging.resolveApproval.mockRejectedValueOnce(Object.assign(
            new Error('This approval was interrupted. Return to the site and try again.'),
            { name: 'ApprovalInterruptedError' },
        ));
        render(
            <ConnectApproval
                id="expired-connect"
                payload={{
                    origin: 'https://dapp.test',
                    requestedChains: ['bitcoin-regtest'],
                }}
                onReject={() => {}}
            />,
        );

        const connect = screen.getByRole('button', { name: 'Approve' });
        fireEvent.click(connect);

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'This connection request has expired.',
        );
        expect(connect).not.toBeDisabled();
        fireEvent.click(connect);
        expect(messaging.resolveApproval).toHaveBeenCalledTimes(1);
    });

    it('clears the password and permanently disables approval when the request expires', async () => {
        messaging.resolveApproval.mockRejectedValueOnce(Object.assign(
            new Error('This approval was interrupted. Return to the site and try again.'),
            { name: 'ApprovalInterruptedError' },
        ));
        render(
            <SignApproval
                id="expired-sign"
                kind="signMessage"
                payload={{ origin: 'https://dapp.test', payload: { message: 'hello' } }}
                onReject={() => {}}
            />,
        );

        const password = await screen.findByLabelText('Password');
        fireEvent.change(password, { target: { value: 'secret' } });
        const approve = screen.getByRole('button', { name: 'Approve' });
        await waitFor(() => expect(approve).not.toBeDisabled());
        fireEvent.click(approve);

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'This approval was interrupted. Return to the site and try again.',
        );
        expect(password).toHaveValue('');
        // The expired request cannot be approved again; the button keeps its
        // colour (G130) and the interrupted notice says why.
        fireEvent.click(approve);
        expect(messaging.resolveApproval).toHaveBeenCalledTimes(1);
    });

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

        expect((await screen.findByTestId('confirm-message-text')).textContent)
            .toBe('Pay alice[U+202E]txt[U+200B]\u2028today');
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
        expect(screen.getAllByText(/original sign-in text/i)).toHaveLength(1);
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
        // Sign in as is the themed dropdown (G119), not radios.
        expect(screen.queryAllByRole('radio')).toHaveLength(0);
        fireEvent.click(await screen.findByRole('button', { name: 'Sign in as: bcrt1qfirstfirstfirst' }));
        fireEvent.click(screen.getByRole('option', { name: /^bcrt1qsecondsecondsecond/ }));
        expect(screen.getByRole('button', { name: 'Sign in as: bcrt1qsecondsecondsecond' })).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Sign In' }).disabled).toBe(false));
        const approve = screen.getByRole('button', { name: 'Sign In' });
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
        // G130: Sign In keeps its colour; the tap names what is missing.
        const signIn = screen.getByRole('button', { name: 'Sign In' });
        expect(signIn.disabled).toBe(false);
        fireEvent.click(signIn);
        expect(screen.getByTestId('confirm-blocked')).toHaveTextContent('Choose the address to sign in with.');
        expect(messaging.resolveApproval).not.toHaveBeenCalled();
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
        expect(document.querySelector('details')).toBeNull();
        await waitFor(() => expect(document.activeElement).toBe(reject));

        await user.keyboard('{Enter}');
        await waitFor(() => expect(messaging.resolveApproval).toHaveBeenCalledWith(
            'keyboard-request',
            { approved: false },
        ));
        messaging.resolveApproval.mockClear();

        const password = screen.getByLabelText('Password', { selector: 'input' });
        password.focus();
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
