// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The recovery screen never shows a user a stack-trace fragment.
//
// The flows this screen calls throw function-prefixed preconditions
// ("importMnemonic: mnemonic is required"), and `setError(err?.message || …)`
// only falls back when the message is EMPTY, so every non-empty dev string
// passed straight through onto the one screen where a user is recovering a
// wallet. `userFacingMessage` is the filter written for exactly this (its own
// header names these strings), and it is a FILTER, not a blanket replacer:
// copy that was written for a user still reaches the user.
//
// Driven through the rendered screen rather than asserted against the source,
// because the thing under test is what a person reads.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'correct-horse-battery';

/** Render the recovery-phrase lane and drive it to a real submit. */
async function submitWith(importMnemonic) {
    render(
        <MessagingProvider shell="web" messaging={{ importMnemonic }}>
            <ImportWallet onBack={() => {}} onImported={() => {}} mode="fresh" />
        </MessagingProvider>,
    );
    fireEvent.change(screen.getByLabelText('Recovery phrase'), { target: { value: PHRASE } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText(/^Confirm/), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(importMnemonic).toHaveBeenCalled());
}

describe('the import screen shows house copy, not flow-layer internals', () => {
    it('swaps a function-prefixed precondition for the screen fallback', async () => {
        const importMnemonic = vi.fn().mockRejectedValue(new Error('importMnemonic: mnemonic is required'));
        await submitWith(importMnemonic);

        await screen.findByText('Failed to import wallet.');
        expect(screen.queryByText(/importMnemonic:/)).toBeNull();
    });

    it('still shows a message the flow wrote for the user', async () => {
        const written = 'That recovery phrase belongs to a wallet you already imported.';
        const importMnemonic = vi.fn().mockRejectedValue(new Error(written));
        await submitWith(importMnemonic);

        await screen.findByText(written);
        expect(screen.queryByText('Failed to import wallet.')).toBeNull();
    });
});
