// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

// The Allow list and Block list fields are pickers (G114): a stand-in picker
// offers list 41 for the allow list and 42 for the block list.
vi.mock('../../../packages/core/src/shared/components/ListPickerScreen.jsx', async () => {
    const ReactModule = await import('react');
    return {
        ListPickerScreen({ title, onSelect }) {
            const index = /allow/i.test(title) ? '41' : '42';
            return ReactModule.createElement(
                'button',
                { type: 'button', onClick: () => onSelect({ actionIndex: index, type: '2', memberCount: null }) },
                `Pick list ${index}`,
            );
        },
    };
});

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { IssueTokenForm } from '../../../packages/core/src/shared/routes/IssueTokenForm.jsx';
import routeStyles from '../../../packages/core/src/shared/components/formStandard/formStandard.module.css';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

const ADDRESS = {
    id: 'addr-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};

function mount() {
    const composeForConfirm = vi.fn().mockResolvedValue({
        psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0,
    });
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ 'bitcoin-mainnet': [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        listContacts: vi.fn().mockResolvedValue([]),
        composeForConfirm,
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        issueToken: vi.fn().mockResolvedValue({ txid: 'deadbeef' }),
    };
    const mounted = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <IssueTokenForm walletId="w" onBack={() => {}} />
        </MessagingProvider>,
    );
    return { ...mounted, composeForConfirm };
}

afterEach(() => cleanup());

// The form is on the Wallet Form Standard; each section header is the
// toggle button of a [data-form-section] root.
function sectionHeaders(container) {
    return [...container.querySelectorAll('[data-form-section] > button[aria-expanded]')];
}

function sectionHeader(container, id) {
    return container.querySelector(`[data-form-section="${id}"] > button[aria-expanded]`);
}

describe('IssueTokenForm custom template sections', () => {
    it('gives the Network field its own help tip', async () => {
        const { container } = mount();
        await screen.findByLabelText('From address');
        // Network sits in the closed From section; open it first.
        fireEvent.click(sectionHeader(container, 'from'));
        expect(screen.getByRole('button', { name: 'About Network' })).toBeTruthy();
    });

    it('renders the approved section contract and composes a ticker-only reservation', async () => {
        const { container, composeForConfirm } = mount();
        const ticker = await screen.findByLabelText('Ticker');
        await screen.findByLabelText('From address');
        const headers = sectionHeaders(container);
        const ids = headers.map((button) => button.parentElement.getAttribute('data-form-section'));

        // The standard order: From, Token (main), the optional
        // sections, then the shared Advanced section directly above Network fee.
        expect(ids).toEqual([
            'from',
            'token',
            'initialMint',
            'publicMinting',
            'description',
            'locks',
            'lists',
            'callback',
            'ownership',
            'advanced',
            'fee',
        ]);
        expect(headers.map((button) => button.querySelector(`.${routeStyles.sectionTitle}`).textContent)).toEqual([
            'From',
            'Token',
            'Initial mint',
            'Public minting',
            'Description',
            'Locks',
            'Allow and block lists',
            'Callback',
            'Transfer ownership',
            'Advanced',
            'Speed and Fees',
        ]);
        // Irreversible sits in FormSection's tag slot, after Optional.
        const locks = headers[ids.indexOf('locks')];
        expect(locks.querySelector('[data-form-section-tag]')).toHaveTextContent('Irreversible');
        expect(locks.textContent.indexOf('Optional')).toBeLessThan(locks.textContent.indexOf('Irreversible'));
        // Optional tag on the optional sections only; never on From, Token or the fee.
        for (const [i, button] of headers.entries()) {
            const optional = !['from', 'token', 'fee'].includes(ids[i]);
            expect(within(button).queryAllByText('Optional')).toHaveLength(optional ? 1 : 0);
        }
        const locksHeader = sectionHeader(container, 'locks');
        expect(within(locksHeader).getByText('Irreversible')).toBeInTheDocument();
        // Token (the main section) starts open; every other section starts closed.
        expect(sectionHeader(container, 'token')).toHaveAttribute('aria-expanded', 'true');
        expect(headers.filter((button) => button !== sectionHeader(container, 'token'))
            .every((button) => button.getAttribute('aria-expanded') === 'false')).toBe(true);
        expect(within(sectionHeader(container, 'publicMinting')).getByText('Not set')).toBeInTheDocument();

        const issueButton = screen.getByRole('button', { name: 'Issue Token' });
        // G22: the submit is enabled with Ticker empty; pressing it says what
        // is missing and composes nothing.
        expect(issueButton).not.toBeDisabled();
        expect(issueButton).toHaveClass(buttonStyles.success);
        expect(issueButton.querySelector('svg')).toBeInTheDocument();
        fireEvent.click(issueButton);
        expect((await screen.findAllByText('Ticker is required.')).length).toBeGreaterThan(0);
        expect(composeForConfirm).not.toHaveBeenCalled();
        expect(sectionHeader(container, 'token')).toHaveAttribute('aria-expanded', 'true');

        const descriptionHeader = sectionHeader(container, 'description');
        fireEvent.click(descriptionHeader);
        // The on-chain cap count shows once, on the open Description field.
        expect(screen.getByText('0 / 250')).toBeInTheDocument();
        expect(screen.queryByText('Up to 250 characters.')).toBeNull();
        fireEvent.change(screen.getByLabelText('Token description'), { target: { value: 'A token' } });
        fireEvent.click(descriptionHeader);
        expect(within(descriptionHeader).getByText('Added')).toBeInTheDocument();
        fireEvent.click(descriptionHeader);
        fireEvent.change(screen.getByLabelText('Token description'), { target: { value: '' } });
        fireEvent.click(descriptionHeader);

        const requiredFields = [...container.querySelectorAll('input[aria-required="true"], textarea[aria-required="true"]')];
        // The standard's From section is required, so its read-only
        // From address is announced as required; Ticker is the one required
        // field the user types.
        expect(requiredFields).toEqual([screen.getByLabelText('From address'), ticker]);
        // The read-only From field (in From) opens the form (U60); Ticker is
        // the first field the user types into, after From.
        expect(container.querySelector('input:not([readonly])')).toBe(ticker);
        expect(screen.getByLabelText('From address').compareDocumentPosition(ticker) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();

        fireEvent.click(locksHeader);
        const lockPanel = document.getElementById(locksHeader.getAttribute('aria-controls'));
        const lockSwitches = within(lockPanel).getAllByRole('switch');
        expect(lockSwitches).toHaveLength(7);
        for (const text of [
            'No one can raise the supply cap',
            'That limit never changes',
            'Blocks the public MINT',
            "Blocks the owner's MINT_SUPPLY through ISSUE",
            'Description can never change',
            'The token can never be paused',
            'No one can ever run a callback on this token again, and its block, token and amount never change',
        ]) {
            expect(within(lockPanel).getByText(text)).toBeInTheDocument();
        }
        expect(within(lockPanel).queryByText(/bridge/i)).toBeNull();
        expect(screen.queryByText(/Bridging is off/i)).toBeNull();

        // The action reads Issue Token with or without a supply (the
        // standard); a ticker-only issue still composes a reservation.
        fireEvent.change(screen.getByRole('textbox', { name: 'Max supply' }), { target: { value: '0' } });
        fireEvent.change(screen.getByLabelText('Initial mint'), { target: { value: '0' } });
        expect(screen.getByRole('button', { name: 'Issue Token' })).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Initial mint'), { target: { value: '10' } });
        expect(screen.getByRole('button', { name: 'Issue Token' })).toHaveClass(buttonStyles.success);
        fireEvent.change(screen.getByLabelText('Initial mint'), { target: { value: '' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'Max supply' }), { target: { value: '21000000' } });
        expect(screen.getByRole('button', { name: 'Issue Token' })).toBeInTheDocument();
        fireEvent.change(screen.getByRole('textbox', { name: 'Max supply' }), { target: { value: '' } });
        fireEvent.change(ticker, { target: { value: 'RESERVED' } });
        fireEvent.click(screen.getByRole('button', { name: 'Issue Token' }));

        await waitFor(() => expect(composeForConfirm).toHaveBeenCalledTimes(1));
        expect(composeForConfirm.mock.calls[0][0].actionData).toMatchObject({
            action: 'ISSUE',
            params: { VERSION: '0', TICK: 'RESERVED', DECIMALS: '8' },
        });
        expect(composeForConfirm.mock.calls[0][0].actionData.params).not.toHaveProperty('MAX_SUPPLY');
        expect(composeForConfirm.mock.calls[0][0].actionData.params).not.toHaveProperty('MINT_SUPPLY');
    });

    it('provides field-specific help for the source, public minting limits, and transfer lists', async () => {
        const { container } = mount();
        await screen.findByLabelText('From address');
        // The From address field lives in the closed From section.
        fireEvent.click(sectionHeader(container, 'from'));
        expect(screen.getByRole('button', { name: 'About From address' })).toBeInTheDocument();

        fireEvent.click(sectionHeader(container, 'publicMinting'));
        for (const label of [
            'Max per transaction',
            'Max per address',
            'Start block',
            'Stop block',
        ]) {
            expect(screen.getByRole('button', { name: `About ${label}` })).toBeInTheDocument();
        }

        fireEvent.click(sectionHeader(container, 'lists'));
        for (const label of ['Allow list', 'Block list']) {
            expect(screen.getByRole('button', { name: `About ${label}` })).toBeInTheDocument();
        }
    });

    it('maps public minting, lists, and every lock to ISSUE v0 fields', async () => {
        const { container, composeForConfirm } = mount();
        fireEvent.change(await screen.findByLabelText('Ticker'), { target: { value: 'LOCKED' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'Max supply' }), { target: { value: '1000' } });

        // The standard section ids give the header order.
        const headers = [null, sectionHeader(container, 'publicMinting'), null,
            sectionHeader(container, 'locks'), sectionHeader(container, 'lists')];
        fireEvent.click(headers[1]);
        fireEvent.change(screen.getByLabelText('Max per transaction'), { target: { value: '25' } });
        fireEvent.change(screen.getByLabelText('Max per address'), { target: { value: '100' } });
        fireEvent.change(screen.getByLabelText('Start block'), { target: { value: '900000' } });
        fireEvent.change(screen.getByLabelText('Stop block'), { target: { value: '910000' } });

        fireEvent.click(headers[3]);
        const lockPanel = document.getElementById(headers[3].getAttribute('aria-controls'));
        for (const lockSwitch of within(lockPanel).getAllByRole('switch')) fireEvent.click(lockSwitch);
        fireEvent.click(headers[3]);
        expect(within(headers[3]).getByText('7 locks on')).toBeInTheDocument();

        fireEvent.click(headers[4]);
        fireEvent.click(screen.getByRole('button', { name: 'Allow list: None set' }));
        fireEvent.click(screen.getByRole('button', { name: 'Pick list 41' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Block list: None set' }));
        fireEvent.click(screen.getByRole('button', { name: 'Pick list 42' }));
        expect(await screen.findByRole('button', { name: 'Block list: List #42' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Issue Token' }));

        await waitFor(() => expect(composeForConfirm).toHaveBeenCalledTimes(1));
        expect(composeForConfirm.mock.calls[0][0].actionData.params).toMatchObject({
            MAX_MINT: '25',
            MINT_ADDRESS_MAX: '100',
            MINT_START_BLOCK: '900000',
            MINT_STOP_BLOCK: '910000',
            ALLOW_LIST: '41',
            BLOCK_LIST: '42',
            LOCK_MAX_SUPPLY: '1',
            LOCK_MAX_MINT: '1',
            LOCK_MINT: '1',
            LOCK_MINT_SUPPLY: '1',
            LOCK_DESCRIPTION: '1',
            LOCK_SLEEP: '1',
            LOCK_CALLBACK: '1',
        });
        expect(composeForConfirm.mock.calls[0][0].actionData.params).not.toHaveProperty('LOCK_BRIDGE');
    });

    it('opens a closed section when one of its fields fails validation', async () => {
        const { container, composeForConfirm } = mount();
        fireEvent.change(await screen.findByLabelText('Ticker'), { target: { value: 'INVALIDMINT' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'Max supply' }), { target: { value: '1000' } });
        const publicMinting = sectionHeader(container, 'publicMinting');
        fireEvent.click(publicMinting);
        fireEvent.change(screen.getByLabelText('Max per transaction'), { target: { value: '0' } });
        fireEvent.click(publicMinting);
        expect(publicMinting).toHaveAttribute('aria-expanded', 'false');

        fireEvent.click(screen.getByRole('button', { name: 'Issue Token' }));

        expect(await screen.findByRole('alert', { name: 'Form errors' })).toHaveTextContent(
            'Max mint per transaction must be a positive number, or left blank for no limit.',
        );
        await waitFor(() => expect(publicMinting).toHaveAttribute('aria-expanded', 'true'));
        expect(composeForConfirm).not.toHaveBeenCalled();
    });
});
