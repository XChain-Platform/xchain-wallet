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

// template -> chain -> details, on the Custom template (the only one
// that carries the advanced disclosure).
async function driveToCustomDetails() {
    fireEvent.click(await screen.findByText('Custom'));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(screen.getByLabelText('Token name (ticker)'), {
        target: { value: 'ADVANCED' },
    });
    fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '1000' } });
}

function openAdvanced() {
    fireEvent.click(screen.getByRole('button', { name: /Advanced settings/i }));
}

function submit() {
    fireEvent.click(screen.getByRole('button', { name: 'Issue token' }));
}

afterEach(() => cleanup());

describe('TokenWizard advanced disclosure (PC-06)', () => {
    it('is collapsed by default and absent from the preset templates', async () => {
        mountWizard();
        fireEvent.click(await screen.findByText('Meme token'));
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        expect(screen.queryByRole('button', { name: /Advanced settings/i })).toBeNull();

        cleanup();
        mountWizard();
        await driveToCustomDetails();
        const toggle = screen.getByRole('button', { name: /Advanced settings/i });
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByLabelText('Callback token (optional)')).toBeNull();
    });

    it('carries locks and a callback into ONE ISSUE v0 compose', async () => {
        mountWizard({ divisibility: 8 });
        await driveToCustomDetails();
        openAdvanced();
        // Wait for the tip so the future-block rail has something to
        // compare against (the form must not block while it is null).
        await waitFor(() => expect(screen.getByText(/Current block on/)).toBeTruthy());

        // Exact match: "Description (optional)" is the free-text field,
        // "Description" on its own is the lock-matrix row.
        fireEvent.click(screen.getByLabelText(/^Description$/));
        fireEvent.change(screen.getByLabelText('Callback token (optional)'), {
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
        await waitFor(() => expect(screen.getByText(/Current block on/)).toBeTruthy());

        fireEvent.change(screen.getByLabelText('Callback token (optional)'), {
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
        fireEvent.change(screen.getByLabelText('Callback token (optional)'), {
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
        await waitFor(() => expect(screen.getByText(/Current block on/)).toBeTruthy());

        fireEvent.change(screen.getByLabelText('Callback token (optional)'), {
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
        fireEvent.change(screen.getByLabelText('Callback token (optional)'), {
            target: { value: 'XCHAIN' },
        });
        // Collapse the panel, then submit: the error names a field the
        // user cannot see, so the panel must come back open.
        fireEvent.click(screen.getByRole('button', { name: /Hide advanced settings/i }));
        expect(screen.queryByLabelText('Callback token (optional)')).toBeNull();

        submit();
        await screen.findByText(/all three/i);
        expect(screen.getByLabelText('Callback token (optional)')).toBeTruthy();
    });

    it('does not offer two controls for one lock field', async () => {
        // The flat "Lock supply + minting immediately" checkbox already
        // commits LOCK_MAX_SUPPLY + LOCK_MINT, so the matrix shows those
        // two rows checked and disabled rather than contradicting it.
        mountWizard();
        await driveToCustomDetails();
        fireEvent.click(screen.getByLabelText(/Lock supply \+ minting immediately/));
        openAdvanced();

        const maxSupplyRow = screen.getByLabelText(/^Max supply \(set by/);
        const mintRow = screen.getByLabelText(/^Minting \(set by/);
        expect(maxSupplyRow.checked).toBe(true);
        expect(maxSupplyRow.disabled).toBe(true);
        expect(mintRow.checked).toBe(true);
        expect(mintRow.disabled).toBe(true);

        // An unrelated flag stays freely checkable.
        const sleepRow = screen.getByLabelText(/^Sleep$/);
        expect(sleepRow.disabled).toBe(false);
    });
});
