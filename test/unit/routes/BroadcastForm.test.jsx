// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Drive the real form and inspect the exact format 0 params handed to the
// host-side composer.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BroadcastForm } from '../../../packages/core/src/shared/routes/BroadcastForm.jsx';

const ADDRESS = 'bc1qexampleexampleexampleexampleexampleex';
const LTC_CHAIN = 'litecoin-regtest';
const ADDRESSES = {
    'bitcoin-mainnet': [
        {
            id: 'addr-1',
            address: ADDRESS,
            publicKey: '02ab',
            derivationPath: "m/84'/0'/0'/0/0",
            source: 'hd',
        },
    ],
};

// The form picks the FIRST chain the host reports addresses for, so a mount on
// another chain hands it that chain alone rather than reordering a shared map.
const LTC_ADDRESSES = {
    [LTC_CHAIN]: [
        {
            id: 'addr-ltc',
            address: 'rltc1qexampleexampleexampleexampleexampleex',
            publicKey: '02cd',
            derivationPath: "m/84'/2'/0'/0/0",
            source: 'hd',
        },
    ],
};

let composeForConfirm;
let broadcastAction;

function mountForm(chainId = 'bitcoin-mainnet', addresses = ADDRESSES, props = {}) {
    composeForConfirm = vi.fn().mockResolvedValue({
        psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0,
    });
    broadcastAction = vi.fn().mockResolvedValue({ txid: 'deadbeef' });
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue(addresses),
        getSettings: vi.fn().mockResolvedValue({ walletMode: props.walletMode || 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        listContacts: vi.fn().mockResolvedValue([]),
        composeForConfirm,
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        broadcastAction,
    };
    // Anything else the form's hooks reach for (native-fee quotes, signer
    // status) answers empty rather than throwing: this suite is about the
    // params, not about what the host knows.
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(BroadcastForm, {
                walletId: 'w',
                initialChainId: chainId,
                initialFromAddress: props.initialFromAddress,
                onBack: props.onBack || (() => {}),
                onDone: props.onDone,
            }),
        ),
    );
}

async function fill(message) {
    fireEvent.change(await screen.findByLabelText('Message'), { target: { value: message } });
}

function submit() {
    fireEvent.click(screen.getByRole('button', { name: 'Broadcast' }));
}

// The BROADCAST params as they reach the host-side compose.
async function composedParams() {
    await waitFor(() => expect(composeForConfirm).toHaveBeenCalled());
    return composeForConfirm.mock.calls[0][0].actionData.params;
}

beforeEach(() => {
    composeForConfirm = undefined;
    broadcastAction = undefined;
});
afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('BroadcastForm plain message flow', () => {
    it('names the watcher action and explains offline signing', async () => {
        mountForm('bitcoin-mainnet', ADDRESSES, { walletMode: 'watcher' });
        await fill('watcher broadcast');
        submit();

        expect(await screen.findByRole('button', { name: 'Broadcast' })).toBeTruthy();
        expect(screen.getByText(/Watcher mode: this prepares the transaction for your offline signer/)).toBeTruthy();
    });

    it('renders only the format 0 authoring fields', async () => {
        mountForm();

        expect(await screen.findByRole('button', { name: 'About Network' })).toBeInTheDocument();
        const message = await screen.findByLabelText('Message');
        expect(message.tagName).toBe('TEXTAREA');
        expect(message).toHaveAttribute('required');
        expect(message).toHaveAttribute('rows', '4');
        expect(message).toHaveAttribute('maxlength', '250');
        expect(screen.getByText('0 / 250')).toBeTruthy();
        expect(screen.queryByText('What do you want to broadcast?')).toBeNull();
        expect(screen.queryByLabelText('Signed transaction')).toBeNull();
        expect(screen.queryByLabelText('Prepend UTC timestamp to memo')).toBeNull();
        expect(screen.queryByLabelText(/Feed name/)).toBeNull();
        expect(screen.queryByLabelText(/^Value/)).toBeNull();
        expect(screen.queryByLabelText(/Feed fee/)).toBeNull();
        expect(screen.getByRole('button', { name: 'Broadcast' })).toBeTruthy();
    });

    it('shows a field error when Message is empty', async () => {
        mountForm();
        await screen.findByLabelText('Message');
        submit();

        expect(await screen.findByText('Message is required.')).toBeTruthy();
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('accepts 250 UTF-16 units of emoji and composes MESSAGE only', async () => {
        mountForm();
        const message = '😀'.repeat(125);
        expect(message.length).toBe(250);
        await fill(message);
        submit();

        const params = await composedParams();
        expect(params).toEqual({ VERSION: '0', MESSAGE: message });
        expect(params).not.toHaveProperty('VALUE');
        expect(params).not.toHaveProperty('FEE');
        expect(params).not.toHaveProperty('MEMO');
    });

    it('refuses a message whose String.length is 251', async () => {
        mountForm();
        const message = `${'😀'.repeat(125)}a`;
        expect(message.length).toBe(251);
        await fill(message);

        expect(screen.getByText('Message is 251 characters; the network accepts at most 250 characters.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Broadcast' })).toBeDisabled();
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('rejects reserved action delimiters before compose', async () => {
        mountForm();
        await fill('a | b');
        submit();

        await screen.findByText(/Remove any \| or ; characters/);
        expect(composeForConfirm).not.toHaveBeenCalled();
    });
});

describe('BroadcastForm success screen', () => {
    it('shows the pending action identity, network explorer, and repeat path', async () => {
        mountForm(LTC_CHAIN, LTC_ADDRESSES);
        await fill('hello chain');
        submit();

        await waitFor(() => expect(composeForConfirm).toHaveBeenCalledTimes(1));
        const confirm = await screen.findByTestId('confirm-modal');
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'test password' } });
        const approve = screen.getByTestId('confirm-approve');
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);

        await waitFor(() => expect(broadcastAction).toHaveBeenCalledTimes(1));
        expect(await screen.findByRole('heading', { name: 'Broadcast pending' })).toBeTruthy();
        expect(screen.getByText('deadbeef')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Copy transaction ID' })).toBeTruthy();
        expect(document.body.textContent).not.toMatch(/Litecoin|regtest|testnet|not mainnet/i);
        expect(screen.getByRole('link', { name: 'View on explorer' })).toHaveAttribute(
            'href',
            'http://localhost:18080/RLTC/tx/deadbeef',
        );
        expect(screen.getByRole('status')).toHaveAttribute('aria-atomic', 'true');
        expect(screen.getAllByRole('status')).toHaveLength(1);

        fireEvent.click(screen.getByRole('button', { name: 'Broadcast another' }));
        expect(await screen.findByRole('button', { name: 'Broadcast' })).toBeTruthy();
        expect(screen.queryByText('deadbeef')).toBeNull();
        expect(confirm).not.toBeInTheDocument();
    });
});

describe('BroadcastForm fee fields', () => {
    it('shows only the network fee selector', async () => {
        mountForm(LTC_CHAIN, LTC_ADDRESSES);
        await screen.findByLabelText('Message');

        expect(screen.getByText('Network fee')).toBeTruthy();
        expect(screen.queryByText(/Protocol fee is paid in LTC/)).toBeNull();
        expect(screen.queryByText(/The fee is sent on-chain and isn't refunded/)).toBeNull();
        expect(screen.queryByText('Protocol fees are paid in LTC')).toBeNull();
    });
});

describe('BroadcastForm field help tips', () => {
    it('gives From and Message a help tip written for this form', async () => {
        mountForm();
        await screen.findByLabelText('Message');

        const fromTip = screen.getByRole('button', { name: 'About From' });
        expect(document.getElementById(fromTip.getAttribute('aria-describedby')).textContent)
            .toBe('The address that signs and pays for this message. The message is recorded on-chain as coming from this address.');
        const messageTip = screen.getByRole('button', { name: 'About Message' });
        expect(document.getElementById(messageTip.getAttribute('aria-describedby')).textContent)
            .toBe('Plain text recorded on-chain with this transaction. Anyone can read it, and it cannot be edited or removed later.');
    });
});
