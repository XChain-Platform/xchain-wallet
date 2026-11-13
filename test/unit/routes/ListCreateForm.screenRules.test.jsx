// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { ListCreateForm } from '../../../packages/core/src/shared/routes/ListCreateForm.jsx';
import { MEMO_HINT } from '../../../packages/core/src/shared/utils/memoLimit.js';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'btc-source',
    address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};

function mount({ walletMode = 'full', metaSupported = true, editResolutionActive = true, contacts = [] } = {}) {
    // The wallet's mode is read from the wallet list, not from settings.
    publishWalletModes({ wallets: [{ id: 'wallet-1', walletMode }], activeWalletId: 'wallet-1' });
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({}),
        listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-1', name: 'W', walletMode }]),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        isListTickCoinActive: vi.fn().mockResolvedValue(false),
        getActionFormats: vi.fn().mockResolvedValue(metaSupported ? { 4: {}, 5: {} } : null),
        listContacts: vi.fn().mockResolvedValue(contacts),
    };
    const messaging = new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[prop] = stub;
            return stub;
        },
    });

    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ListCreateForm
                walletId="wallet-1"
                chainId={CHAIN}
                initialType="2"
                editResolutionActive={editResolutionActive}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
    return messaging;
}

afterEach(() => {
    cleanup();
    resetWalletModes();
    vi.clearAllMocks();
});

describe('ListCreateForm screen rules', () => {
    it.each([
        [true, 'everything that references this list then uses the edited membership'],
        [false, 'Fork & edit) only creates a new list at a new index'],
        [null, 'before that, a fork is a separate list at a new index'],
    ])('moves address explanations into the tip when edit resolution is %s', async (editResolutionActive, editCopy) => {
        mount({ editResolutionActive });
        await screen.findByLabelText('From');

        expect(screen.queryByText(/These addresses become permanent public on-chain data/, { selector: 'p' }))
            .not.toBeInTheDocument();
        expect(screen.queryByText(/can never be bridged to another network/, { selector: 'p' }))
            .not.toBeInTheDocument();
        expect(screen.queryByText(/A bigger list is a bigger transaction/, { selector: 'p' }))
            .not.toBeInTheDocument();
        expect(screen.getByText(/^Action size: .* bytes\.$/, { selector: 'p' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'About Addresses' }));
        const tip = screen.getByRole('tooltip');
        expect(tip).toHaveTextContent('These addresses become permanent public on-chain data');
        expect(tip).toHaveTextContent(editCopy);
        expect(tip).toHaveTextContent('can never be bridged to another network');
        expect(tip).toHaveTextContent('Each address adds to the transaction size and increases the network fee');
    });

    it('marks list metadata optional and gives each field its own public byte-limit tip', async () => {
        const messaging = mount();
        await waitFor(() => expect(messaging.getActionFormats).toHaveBeenCalled());

        const name = await screen.findByLabelText('Name');
        const description = screen.getByLabelText('Description');
        // Name and Description sit in one optional Details section;
        // its header carries the Optional tag, not the fields.
        const details = screen.getByRole('button', { name: /^Details\b/, expanded: false });
        expect(within(details).getByText('Optional')).toBeInTheDocument();
        const section = details.closest('section');
        expect(section).toContainElement(name);
        expect(section).toContainElement(description);
        fireEvent.click(details);
        expect(screen.getByRole('button', { name: 'About Name' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'About Description' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'About Name' }));
        expect(screen.getByRole('tooltip')).toHaveTextContent('public on-chain name');
        expect(screen.getByRole('tooltip')).toHaveTextContent('64 UTF-8 bytes');
        fireEvent.keyDown(document, { key: 'Escape' });
        fireEvent.click(screen.getByRole('button', { name: 'About Description' }));
        expect(screen.getByRole('tooltip')).toHaveTextContent('public on-chain description');
        expect(screen.getByRole('tooltip')).toHaveTextContent('512 UTF-8 bytes');
    });

    it('uses list-specific Memo help', async () => {
        mount();
        await screen.findByLabelText('Memo');

        // Memo is an optional closed section.
        fireEvent.click(screen.getByRole('button', { name: /^Memo\b/, expanded: false }));
        fireEvent.click(screen.getByRole('button', { name: 'About Memo' }));
        const tip = screen.getByRole('tooltip');
        expect(tip).toHaveTextContent('stored on-chain with this list creation action');
        expect(tip).toHaveTextContent("separate from the list's name and description");
        expect(tip).not.toHaveTextContent(MEMO_HINT);
    });

    it('renders Publish List as an explicit green action with an icon', async () => {
        mount();
        const submit = await screen.findByRole('button', { name: /^Publish List$/ });

        expect(submit).toHaveClass(buttonStyles.success);
        expect(submit.querySelector('svg')).toBeInTheDocument();
    });

    it('names the watcher form action and never renders a generic Review button', async () => {
        mount({ walletMode: 'watcher' });

        const formSubmit = await screen.findByRole('button', { name: /^Create Unsigned Transaction$/ });
        expect(formSubmit).toHaveClass(buttonStyles.success);
        expect(formSubmit.querySelector('svg')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Addresses'), { target: { value: ADDRESS.address } });
        fireEvent.click(formSubmit);
        const reviewSubmit = await screen.findByRole('button', { name: /^Create Unsigned Transaction$/ });
        expect(reviewSubmit).not.toBe(formSubmit);
        expect(reviewSubmit).toHaveClass(buttonStyles.success);
        expect(reviewSubmit.querySelector('svg')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Back' }).querySelector('svg')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument();
    });

    // A form error raised on Publish opens the closed section that
    // holds its field, on every attempt, even after the user closed it.
    it('opens the closed Memo section when Publish refuses the memo', async () => {
        mount();
        await screen.findByLabelText('From');
        const memoHeader = screen.getByRole('button', { name: /^Memo\b/ });
        expect(memoHeader).toHaveAttribute('aria-expanded', 'false');
        fireEvent.change(screen.getByLabelText('Memo'), { target: { value: 'a|b' } });
        fireEvent.click(screen.getByRole('button', { name: /^Publish List$/ }));
        expect(await screen.findByText('Memo cannot contain | or ; characters.')).toBeInTheDocument();
        await waitFor(() => expect(memoHeader).toHaveAttribute('aria-expanded', 'true'));
        fireEvent.click(memoHeader);
        expect(memoHeader).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(screen.getByRole('button', { name: /^Publish List$/ }));
        await waitFor(() => expect(memoHeader).toHaveAttribute('aria-expanded', 'true'));
    });

    it('gives the contact picker add action an icon', async () => {
        mount({
            contacts: [{
                id: 'contact-1',
                name: 'Alice',
                entries: [{ chain: 'bitcoin', address: ADDRESS.address, label: 'Primary' }],
            }],
        });
        fireEvent.click(await screen.findByRole('button', { name: 'Add From Contacts' }));
        fireEvent.click(await screen.findByRole('checkbox', { name: /Alice/ }));

        const add = screen.getByRole('button', { name: 'Add 1 Selected' });
        expect(add.querySelector('svg')).toBeInTheDocument();
    });
});
