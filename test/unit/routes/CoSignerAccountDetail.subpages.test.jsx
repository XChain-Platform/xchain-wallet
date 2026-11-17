// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The agent account page's sub-pages. Fund opens a page of its own: the agent
// address as a QR with its copy button, over the standard Send form whose
// destination is that address. Edit rules and Fund stand in for the agent
// page, so their Back returns to it and never to the agents list. Withdraw
// stays a disabled row: the wallet holds only its half of the shared key.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('qrcode', () => ({
    default: { toDataURL: vi.fn(async (value) => `data:image/png;base64,${btoa(String(value))}`) },
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CoSignerAccountDetail } from '../../../packages/core/src/shared/routes/CoSignerAccountDetail.jsx';

afterEach(() => cleanup());

const AGENT_ADDRESS = 'bcrt1pagentagentagentagentagentagentagentagentagentagentag';
const OWN_ADDRESS = 'bcrt1qownownownownownownownownownownownown0';

function account(overrides = {}) {
    return {
        id: 'acct-1',
        walletId: 'wallet-1',
        name: 'Trading bot',
        chainId: 'bitcoin-regtest',
        aggregateAddress: AGENT_ADDRESS,
        agentPubkey: '02' + 'a'.repeat(64),
        daemonPubkey: '03' + 'b'.repeat(64),
        recoveryPublicKey: null,
        enabled: true,
        policy: { allowedActions: ['SEND'] },
        allowedOutputs: [],
        window: { entries: [] },
        ...overrides,
    };
}

function mountDetail() {
    const base = {
        getSettings: vi.fn().mockResolvedValue({}),
        getCoSignerAccount: vi.fn().mockResolvedValue(account()),
        getCoSignerAccountBalances: vi.fn().mockResolvedValue({}),
        listCoSignRequests: vi.fn().mockResolvedValue([]),
        updateCoSignerAccount: vi.fn(),
        getAddressesByChain: vi.fn().mockResolvedValue({
            'bitcoin-regtest': [{
                id: 'addr-1', address: OWN_ADDRESS, publicKey: '02ab',
                derivationPath: "m/84'/1'/0'/0/0", source: 'hd',
            }],
        }),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [],
        }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: true }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        getDispensersForAddress: vi.fn().mockResolvedValue({ data: [] }),
    };
    // Any read the Send form makes that this test does not name answers null.
    const messaging = new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string' || prop === 'then') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[prop] = stub;
            return stub;
        },
    });
    const onBack = vi.fn();
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <CoSignerAccountDetail accountId="acct-1" walletId="wallet-1" onBack={onBack} />
        </MessagingProvider>,
    );
    return { messaging, onBack };
}

const headerBack = () => screen.getByRole('button', { name: 'Back to previous screen' });

describe('Agent account Fund page', () => {
    it('opens a page with the address QR and copy, over a Send form to the agent address', async () => {
        const { messaging } = mountDetail();
        await screen.findByRole('region', { name: 'Agent account' });
        const fund = screen.getByRole('button', { name: /^Fund/ });
        // The row goes somewhere, so it is no disclosure toggle.
        expect(fund).not.toHaveAttribute('aria-expanded');
        fireEvent.click(fund);

        const card = await screen.findByRole('region', { name: 'Fund this address' });
        expect(await within(card).findByRole('img', { name: `QR code for ${AGENT_ADDRESS}` })).toBeInTheDocument();
        expect(within(card).getByRole('button', { name: 'Copy Funding Address' })).toBeInTheDocument();

        // The standard Send form, titled Fund, with the agent address as To.
        expect(screen.getByRole('heading', { name: 'Fund' })).toBeInTheDocument();
        expect(screen.getByRole('form', { name: 'Send' })).toBeInTheDocument();
        await waitFor(() => expect(screen.getByLabelText(/^To$/)).toHaveValue(AGENT_ADDRESS));
        // The agent page is gone while Fund stands in for it.
        expect(screen.queryByRole('region', { name: 'Agent account' })).toBeNull();
        // Opening Fund writes nothing to the account.
        expect(messaging.updateCoSignerAccount).not.toHaveBeenCalled();
    });

    it('keeps its draft per agent, apart from the Send page, and saves none for the preset To alone', async () => {
        localStorage.clear();
        mountDetail();
        await screen.findByRole('region', { name: 'Agent account' });
        fireEvent.click(screen.getByRole('button', { name: /^Fund/ }));
        await waitFor(() => expect(screen.getByLabelText(/^To$/)).toHaveValue(AGENT_ADDRESS));
        const draftKeys = () => Object.keys(localStorage).filter((key) => key.startsWith('xc:formdraft:'));
        // The agent address the page set is not the user's input.
        expect(draftKeys()).toEqual([]);
        fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: '0.01' } });
        await waitFor(() => expect(draftKeys()).toEqual(['xc:formdraft:cosigner-fund:acct-1:wallet-1']));
        localStorage.clear();
    });

    it('returns to the agent page on Back, never to the agents list', async () => {
        const { onBack } = mountDetail();
        await screen.findByRole('region', { name: 'Agent account' });
        fireEvent.click(screen.getByRole('button', { name: /^Fund/ }));
        await screen.findByRole('region', { name: 'Fund this address' });
        fireEvent.click(headerBack());
        expect(await screen.findByRole('region', { name: 'Agent account' })).toBeInTheDocument();
        expect(screen.getByRole('list', { name: 'Actions' })).toBeInTheDocument();
        expect(onBack).not.toHaveBeenCalled();
    });
});

describe('Agent account Edit rules', () => {
    it('returns to the agent page on Back, never to the agents list', async () => {
        const { onBack } = mountDetail();
        await screen.findByRole('region', { name: 'Agent account' });
        fireEvent.click(screen.getByRole('button', { name: /^Edit rules/ }));
        expect(await screen.findByRole('button', { name: 'Update Policy' })).toBeInTheDocument();
        fireEvent.click(headerBack());
        expect(await screen.findByRole('region', { name: 'Agent account' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Update Policy' })).toBeNull();
        expect(onBack).not.toHaveBeenCalled();
        // Back on the agent page itself still leaves for the list.
        fireEvent.click(headerBack());
        expect(onBack).toHaveBeenCalledTimes(1);
    });
});

describe('Agent account Withdraw', () => {
    it('stays a disabled row that says why, since only the agent can start a spend', async () => {
        const { messaging } = mountDetail();
        await screen.findByRole('region', { name: 'Agent account' });
        const withdraw = screen.getByRole('button', { name: /^Withdraw/ });
        expect(withdraw).toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(withdraw);
        expect(screen.getByRole('region', { name: 'Agent account' })).toBeInTheDocument();
        expect(messaging.updateCoSignerAccount).not.toHaveBeenCalled();
    });
});
