// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-06: behavioural coverage for the Token Creation Wizard's advanced
// disclosure. The source-assertion smoke proves the wiring exists; this
// drives the real form and proves the two things that actually protect
// the user:
//
//   1. A valid advanced set reaches the host compose as ISSUE v0 fields,
//      in ONE transaction alongside the token creation.
//   2. A rejected advanced value stops the flow BEFORE composing. That
//      matters more here than on the admin edits: every field shares the
//      create action, so a value the indexer refuses means the token is
//      never created at all.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';

const ADDRESSES = {
    'bitcoin-mainnet': [
        {
            id: 'addr-1',
            address: 'bc1qexampleexampleexampleexampleexampleex',
            publicKey: '02ab',
            derivationPath: "m/84'/0'/0'/0/0",
            source: 'hd',
        },
    ],
};

const TIP = 900000;

let composeForConfirm;

function mountWizard({ divisibility = null } = {}) {
    composeForConfirm = vi.fn().mockResolvedValue({
        psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0,
    });
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: TIP }),
        getTokenInfo: vi.fn().mockResolvedValue({ divisibility }),
        composeForConfirm,
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        issueToken: vi.fn().mockResolvedValue({ txid: 'deadbeef' }),
    };
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(TokenWizard, { walletId: 'w', onBack() {} }),
        ),
    );
}

// "Max supply" also names a lock switch, so the amount field is read by id.
const supplyInput = () => screen.getByLabelText('Max supply', { selector: '#issue-supply' });

// The wizard route is the one Issue Token form: ticker and max supply sit
// in the open Token section, every other group in a closed section whose
// fields are still mounted (hidden) until it is opened.
async function driveToCustomDetails() {
    fireEvent.change(await screen.findByLabelText('Ticker'), {
        target: { value: 'ADVANCED' },
    });
    fireEvent.change(supplyInput(), { target: { value: '1000' } });
}

// The Limited edition preset fills the supply and per-address limit; the
// tests then set the same sizes the old edition template asked for.
async function driveToEditionDetails() {
    fireEvent.click(await screen.findByRole('button', { name: /^Select template/ }));
    fireEvent.click(screen.getByRole('option', { name: /Limited edition/ }));
    fireEvent.change(screen.getByLabelText('Ticker'), {
        target: { value: 'EDITION' },
    });
    fireEvent.change(supplyInput(), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText('Max per transaction'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Max per address'), { target: { value: '10' } });
    // An edition carries its artwork as the Image URL, which it requires.
    fireEvent.change(screen.getByLabelText('Image URL'), { target: { value: 'https://example.com/prints.png' } });
}

function openSection(title) {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${title}`), expanded: false }));
}

// The Callback fields (token, payout per unit, allowed-from block) live in
// the form's own optional Callback section.
function openAdvanced() {
    openSection('Callback');
}

function submit() {
    fireEvent.click(screen.getByRole('button', { name: 'Issue Token' }));
}

afterEach(() => cleanup());

describe('TokenWizard advanced disclosure (PC-06)', () => {
    it('rejects malformed supply text before composing', async () => {
        mountWizard();
        await driveToCustomDetails();
        // Thousands separators are accepted by the amount field now, so the
        // malformed text is a non-number.
        fireEvent.change(supplyInput(), { target: { value: 'Infinity' } });

        submit();
        // The amount field names its own refusal.
        expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid decimal amount');
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it.each([
        // The amount fields name their own refusal.
        ['Max per transaction', 'Infinity', 'Enter a valid decimal amount'],
        ['Max per address', 'many', 'Enter a valid decimal amount'],
        ['Start block', '10.5', 'Start block must be a whole block height.'],
        ['Stop block', 'later', 'Stop block must be a whole block height.'],
    ])('rejects malformed edition text in %s', async (label, value, message) => {
        mountWizard();
        await driveToEditionDetails();
        fireEvent.change(screen.getByLabelText(label), { target: { value } });

        submit();
        expect(await screen.findByRole('alert')).toHaveTextContent(message);
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('rejects an edition address limit below its per-mint amount', async () => {
        mountWizard();
        await driveToEditionDetails();
        fireEvent.change(screen.getByLabelText('Max per address'), {
            target: { value: '5' },
        });

        submit();
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Max mint per address cannot be less than max mint per transaction.',
        );
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it.each([
        ['New owner address', /Transfer ownership address is not valid for the active network/i],
        ['Send initial mint to', /Initial mint destination is not valid for the active network/i],
    ])('rejects an invalid %s address before composing', async (label, message) => {
        mountWizard();
        await driveToCustomDetails();
        fireEvent.change(screen.getByLabelText(label), { target: { value: 'not-an-address' } });

        submit();
        expect(await screen.findByRole('alert')).toHaveTextContent(message);
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('keeps the optional sections collapsed by default, with the Token section open', async () => {
        mountWizard();
        await driveToCustomDetails();
        expect(screen.getByRole('button', { name: /^Token/ }).getAttribute('aria-expanded')).toBe('true');
        for (const title of ['Initial mint', 'Public minting', 'Description', 'Locks']) {
            const toggle = screen.getByRole('button', { name: new RegExp(`^${title}`) });
            expect(toggle.getAttribute('aria-expanded'), title).toBe('false');
        }
    });

    it('carries locks and a callback into ONE ISSUE v0 compose', async () => {
        mountWizard({ divisibility: 8 });
        await driveToCustomDetails();
        openAdvanced();
        // Wait for the tip so the future-block rail has something to
        // compare against (the form must not block while it is null).
        await waitFor(() => expect(screen.getByText(/Current block:/)).toBeTruthy());

        // Description names both the free-text field and the lock-matrix row.
        fireEvent.click(screen.getByLabelText(/^Description$/, {
            selector: 'input[type="checkbox"]',
        }));
        fireEvent.change(screen.getByLabelText('Callback token'), {
            target: { value: 'xchain' },
        });
        fireEvent.change(screen.getByLabelText('Payout per unit'), { target: { value: '2.5' } });
        fireEvent.change(screen.getByLabelText('Callback allowed from block'), {
            target: { value: String(TIP + 100) },
        });
        // The payout hint only names a decimal count once the callback
        // token's divisibility has actually come back, so this is the
        // signal that the debounced lookup resolved.
        await screen.findByText(/Up to 8 decimal places/);

        submit();
        await waitFor(() => expect(composeForConfirm).toHaveBeenCalledTimes(1));
        const { actionData } = composeForConfirm.mock.calls[0][0];
        expect(actionData.action).toBe('ISSUE');
        expect(actionData.params).toMatchObject({
            VERSION: '0',
            TICK: 'ADVANCED',
            MAX_SUPPLY: '1000',
            LOCK_DESCRIPTION: '1',
            CALLBACK_TICK: 'XCHAIN',
            CALLBACK_AMOUNT: '2.5',
            CALLBACK_BLOCK: String(TIP + 100),
        });
    });

    it('refuses to compose a callback block at or below the chain tip', async () => {
        // The indexer's own future-block guard is gated on an existing
        // token record, so it does NOT run on a create: without this
        // rail the token would be created with its callback already live.
        mountWizard({ divisibility: 8 });
        await driveToCustomDetails();
        openAdvanced();
        await waitFor(() => expect(screen.getByText(/Current block:/)).toBeTruthy());

        fireEvent.change(screen.getByLabelText('Callback token'), {
            target: { value: 'XCHAIN' },
        });
        fireEvent.change(screen.getByLabelText('Payout per unit'), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Callback allowed from block'), {
            target: { value: String(TIP) },
        });

        submit();
        await screen.findByText(/must be in the future/i);
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('refuses to compose a half-built callback', async () => {
        mountWizard();
        await driveToCustomDetails();
        openAdvanced();
        fireEvent.change(screen.getByLabelText('Callback token'), {
            target: { value: 'XCHAIN' },
        });

        submit();
        await screen.findByText(/all three/i);
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('refuses a fractional payout while the callback token divisibility is unproven', async () => {
        // getTokenInfo answers with no divisibility, so the payout is
        // held to whole numbers: the indexer would price it at 0
        // decimals and invalidate the whole creation.
        mountWizard({ divisibility: null });
        await driveToCustomDetails();
        openAdvanced();
        await waitFor(() => expect(screen.getByText(/Current block:/)).toBeTruthy());

        fireEvent.change(screen.getByLabelText('Callback token'), {
            target: { value: 'GHOST' },
        });
        fireEvent.change(screen.getByLabelText('Payout per unit'), { target: { value: '0.5' } });
        fireEvent.change(screen.getByLabelText('Callback allowed from block'), {
            target: { value: String(TIP + 10) },
        });

        submit();
        // Assert on the error region specifically: the payout hint also
        // says "whole numbers only" while divisibility is unproven.
        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toMatch(/whole number/i);
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('re-opens the panel when a rejected field is hidden behind it', async () => {
        mountWizard();
        await driveToCustomDetails();
        openAdvanced();
        fireEvent.change(screen.getByLabelText('Callback token'), {
            target: { value: 'XCHAIN' },
        });
        // Collapse the section, then submit: the error names a field the
        // user cannot see, so the section must come back open.
        const header = () => screen.getByRole('button', { name: /^Callback/ });
        fireEvent.click(header());
        expect(header().getAttribute('aria-expanded')).toBe('false');

        submit();
        expect(await screen.findByRole('alert')).toHaveTextContent(/all three/i);
        await waitFor(() => expect(header().getAttribute('aria-expanded')).toBe('true'));
        expect(screen.getByRole('textbox', { name: 'Callback token' })).toBeVisible();
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('does not offer two controls for one lock field', async () => {
        // The Issue Token form has no flat "Lock supply + minting
        // immediately" switch beside the lock list: each lock field has
        // exactly one control, so none can contradict another.
        mountWizard();
        await driveToCustomDetails();
        expect(screen.queryByLabelText(/Lock supply \+ minting immediately/)).toBeNull();
        openSection('Locks');

        const maxSupplyRows = screen.getAllByRole('switch', { name: /^Max supply/ });
        const mintRows = screen.getAllByRole('switch', { name: /^Minting/ });
        expect(maxSupplyRows).toHaveLength(1);
        expect(mintRows).toHaveLength(1);
        expect(maxSupplyRows[0].checked).toBe(false);
        expect(maxSupplyRows[0].disabled).toBe(false);

        // Turning one lock on leaves an unrelated flag freely checkable.
        fireEvent.click(maxSupplyRows[0]);
        expect(screen.getByRole('switch', { name: /^Max supply/ }).checked).toBe(true);
        const sleepRow = screen.getByRole('switch', { name: /^Pause/ });
        expect(sleepRow.disabled).toBe(false);
    });
});
