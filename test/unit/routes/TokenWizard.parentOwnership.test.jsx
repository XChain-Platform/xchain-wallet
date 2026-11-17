// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Issue Token form's Subtoken template looks the parent up before every
// compose. The chain refuses a child whose parent is missing or owned by
// another address, and it does so after the fee is spent, so the wallet
// refuses first. An explorer that cannot answer is a refusal, never a pass.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
// The Create a token route: TokenWizard renders the one Issue Token form.
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { ownedTokensFor, pickParentToken } from '../../helpers/issueParentPicker.js';

const OWNER = 'bc1qownerownerownerownerownerownerownerow';
const STRANGER = 'bc1qstrangerstrangerstrangerstrangerstrang';

const ADDRESSES = {
    'bitcoin-mainnet': [{
        id: 'addr-0',
        address: OWNER,
        publicKey: '02ab',
        derivationPath: "m/84'/0'/0'/0/0",
        source: 'hd',
    }],
};

async function review(parentLookup, overrides = {}) {
    // The availability lookup for PARENT.CHILD answers 'not issued'; only
    // the parent lookup takes the case's answer.
    const getTokenInfo = vi.fn((req) => (req.tick === 'PARENT' ? parentLookup(req) : Promise.resolve({})));
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getTokenInfo,
        // The picker lists PARENT; the lookup at submit decides ownership.
        getOwnedTokens: ownedTokensFor(vi.fn, OWNER, ['PARENT']),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0,
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        ...overrides,
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenWizard walletId="w" onBack={() => {}} />
        </MessagingProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /^Select template/ }));
    fireEvent.click(screen.getByRole('option', { name: /Subtoken/ }));
    await pickParentToken('PARENT');
    fireEvent.change(screen.getByLabelText('Subtoken name'), { target: { value: 'CHILD' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Max supply' }), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue Token' }));
    return messaging;
}

describe('Issue Token subtoken parent lookup', () => {
    afterEach(() => {
        cleanup();
        resetWalletModes();
    });

    it('composes PARENT.CHILD when this wallet owns the existing parent', async () => {
        const getTokenInfo = vi.fn().mockResolvedValue({ creator: OWNER });
        const messaging = await review(getTokenInfo);
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        expect(getTokenInfo).toHaveBeenCalledWith(expect.objectContaining({ tick: 'PARENT' }));
        const { actionData, from } = messaging.composeForConfirm.mock.calls[0][0];
        expect(actionData.params.TICK).toBe('PARENT.CHILD');
        expect(actionData.params.MAX_SUPPLY).toBe('100');
        // Signed by the parent's owner, the only source the chain accepts.
        expect(from.address).toBe(OWNER);
    });

    it('refuses a parent that the explorer does not know', async () => {
        const messaging = await review(vi.fn().mockResolvedValue({ creator: null }));
        expect(await screen.findByRole('alert', { name: 'Form errors' })).toHaveTextContent(/PARENT could not be confirmed as a token this wallet owns/);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('refuses a parent owned by another address', async () => {
        const messaging = await review(vi.fn().mockResolvedValue({ creator: STRANGER }));
        expect(await screen.findByRole('alert', { name: 'Form errors' })).toHaveTextContent(/This wallet does not own PARENT/);
        // The refusal is keyed to the Parent token field, so that field is
        // outlined red with the same line under it (the form error standard).
        const parentField = document.getElementById('issue-parent-ticker');
        expect(parentField.getAttribute('aria-invalid')).toBe('true');
        expect(document.getElementById('issue-parent-ticker-error')).toHaveTextContent(/This wallet does not own PARENT/);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('looks the parent up again before a watcher build', async () => {
        // Watcher mode reviews before it builds; the parent can change hands
        // while that review sits open.
        publishWalletModes({ wallets: [{ id: 'w', walletMode: 'watcher' }], activeWalletId: 'w' });
        let owner = OWNER;
        const messaging = await review(vi.fn(() => Promise.resolve({ creator: owner })), {
            buildActionPsbtRequest: vi.fn().mockResolvedValue({ psbtHex: '70736274ff00' }),
        });
        await screen.findByTestId('confirm-modal');
        expect(screen.getByTestId('confirm-sentence')).toHaveTextContent('Issue');
        owner = STRANGER;
        await waitFor(() => expect(screen.getByTestId('confirm-approve')).not.toBeDisabled());
        fireEvent.click(screen.getByTestId('confirm-approve'));
        expect(await screen.findByText(/This wallet does not own PARENT/)).toBeTruthy();
        expect(messaging.buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('refuses when the explorer cannot answer', async () => {
        const messaging = await review(vi.fn().mockRejectedValue(new Error('explorer 500')));
        expect(await screen.findByRole('alert', { name: 'Form errors' })).toHaveTextContent(/PARENT could not be confirmed as a token this wallet owns/);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });
});
