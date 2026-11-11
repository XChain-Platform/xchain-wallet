// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { IssueTokenForm } from '../../../packages/core/src/shared/routes/IssueTokenForm.jsx';
import routeStyles from '../../../packages/core/src/shared/routes/IssueTokenForm.module.css';
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

describe('IssueTokenForm custom template sections', () => {
    it('gives the Network field its own help tip', async () => {
        mount();
        await screen.findByLabelText('From');
        expect(screen.getByRole('button', { name: 'About Network' })).toBeTruthy();
    });

    it('renders the approved section contract and composes a ticker-only reservation', async () => {
        const { container, composeForConfirm } = mount();
        const ticker = await screen.findByLabelText('Ticker');
        await screen.findByLabelText('From');
        const sectionHeaders = [...container.querySelectorAll('button[aria-controls^="issue-section-"]')];

        expect(sectionHeaders.map((button) => within(button).getByText(
            /^(Supply|Public minting|Description|Locks|Allow and block lists|Transfer ownership)$/,
        ).textContent)).toEqual([
            'Supply',
            'Public minting',
            'Description',
            'Locks',
            'Allow and block lists',
            'Transfer ownership',
        ]);
        for (const button of sectionHeaders) {
            expect(within(button).getAllByText('Optional')).toHaveLength(1);
        }
        expect(within(sectionHeaders[3]).getByText('Irreversible')).toBeInTheDocument();
        expect(sectionHeaders[0]).toHaveAttribute('aria-expanded', 'true');
        expect(sectionHeaders.slice(1).every((button) => button.getAttribute('aria-expanded') === 'false')).toBe(true);
        expect(within(sectionHeaders[1]).getByText('Not set')).toBeInTheDocument();
        const openChevron = sectionHeaders[0].querySelector(`.${routeStyles.sectionChevron}`);
        const closedChevron = sectionHeaders[1].querySelector(`.${routeStyles.sectionChevron}`);
        expect(openChevron).toHaveClass(routeStyles.sectionChevronTrailing);
        expect(closedChevron).not.toHaveClass(routeStyles.sectionChevronTrailing);

        expect(screen.getByText('0 / 250')).toBeInTheDocument();
        expect(screen.queryByText('Up to 250 characters.')).toBeNull();

        const reserveButton = screen.getByRole('button', { name: 'Reserve ticker' });
        expect(reserveButton).toBeDisabled();
        expect(reserveButton).toHaveClass(buttonStyles.success);
        expect(reserveButton.querySelector('svg')).toBeInTheDocument();

        fireEvent.click(sectionHeaders[2]);
        fireEvent.change(screen.getByLabelText('Token description'), { target: { value: 'A token' } });
        fireEvent.click(sectionHeaders[2]);
        expect(within(sectionHeaders[2]).getByText('Added')).toBeInTheDocument();
        fireEvent.click(sectionHeaders[2]);
        fireEvent.change(screen.getByLabelText('Token description'), { target: { value: '' } });
        fireEvent.click(sectionHeaders[2]);

        const requiredFields = [...container.querySelectorAll('input[aria-required="true"], textarea[aria-required="true"]')];
        expect(requiredFields).toEqual([ticker]);
        // Network and the read-only From field open every action form (U60);
        // Ticker is the first field the user types into, directly after From.
        expect(container.querySelector('input:not([readonly])')).toBe(ticker);
        expect(screen.getByLabelText('From').compareDocumentPosition(ticker) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();

        fireEvent.click(sectionHeaders[3]);
        const lockPanel = document.getElementById(sectionHeaders[3].getAttribute('aria-controls'));
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

        expect(screen.getByRole('button', { name: 'Reserve ticker' })).toBeInTheDocument();
        fireEvent.change(screen.getByRole('textbox', { name: 'Max supply' }), { target: { value: '0' } });
        fireEvent.change(screen.getByLabelText('Initial mint'), { target: { value: '0' } });
        expect(screen.getByRole('button', { name: 'Reserve ticker' })).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Initial mint'), { target: { value: '10' } });
        const issueButton = screen.getByRole('button', { name: 'Issue token' });
        expect(issueButton).toHaveClass(buttonStyles.success);
        expect(issueButton.querySelector('svg')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Initial mint'), { target: { value: '' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'Max supply' }), { target: { value: '21000000' } });
        expect(screen.getByRole('button', { name: 'Issue token' })).toBeInTheDocument();
        fireEvent.change(screen.getByRole('textbox', { name: 'Max supply' }), { target: { value: '' } });
        fireEvent.change(ticker, { target: { value: 'RESERVED' } });
        fireEvent.click(screen.getByRole('button', { name: 'Reserve ticker' }));

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
        await screen.findByLabelText('From');
        expect(screen.getByRole('button', { name: 'About From' })).toBeInTheDocument();

        fireEvent.click(container.querySelector('button[aria-controls="issue-section-public-minting"]'));
        for (const label of [
            'Max per transaction',
            'Max per address',
            'Start block',
            'Stop block',
        ]) {
            expect(screen.getByRole('button', { name: `About ${label}` })).toBeInTheDocument();
        }

        fireEvent.click(container.querySelector('button[aria-controls="issue-section-lists"]'));
        for (const label of ['Allow list', 'Block list']) {
            expect(screen.getByRole('button', { name: `About ${label}` })).toBeInTheDocument();
        }
    });

    it('maps public minting, lists, and every lock to ISSUE v0 fields', async () => {
        const { container, composeForConfirm } = mount();
        fireEvent.change(await screen.findByLabelText('Ticker'), { target: { value: 'LOCKED' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'Max supply' }), { target: { value: '1000' } });

        const headers = [...container.querySelectorAll('button[aria-controls^="issue-section-"]')];
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
        fireEvent.change(screen.getByLabelText('Allow list'), { target: { value: '41' } });
        fireEvent.change(screen.getByLabelText('Block list'), { target: { value: '42' } });
        fireEvent.click(screen.getByRole('button', { name: 'Issue token' }));

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
        const publicMinting = container.querySelector('button[aria-controls="issue-section-public-minting"]');
        fireEvent.click(publicMinting);
        fireEvent.change(screen.getByLabelText('Max per transaction'), { target: { value: '0' } });
        fireEvent.click(publicMinting);
        expect(publicMinting).toHaveAttribute('aria-expanded', 'false');

        fireEvent.click(screen.getByRole('button', { name: 'Issue token' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Max mint per transaction must be a positive number, or left blank for no limit.',
        );
        await waitFor(() => expect(publicMinting).toHaveAttribute('aria-expanded', 'true'));
        expect(composeForConfirm).not.toHaveBeenCalled();
    });
});
