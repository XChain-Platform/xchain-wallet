// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Test backup form says what to fix when the phrase is wrong, and never
// shows a flow's developer-prefixed error ("importMnemonic: bip39 ...").
// Errors arrive hydrated from the shell envelope, so only name and message
// survive; the fixtures below are built the same way.

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BackupSection } from '../../../packages/core/src/shared/components/settings/BackupSection.jsx';

afterEach(() => cleanup());

function hydrated(name, message) {
    return Object.assign(new Error(message), { name });
}

async function runWith(rejection) {
    const messaging = { dryRunRestoreRequest: vi.fn().mockRejectedValue(rejection) };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <BackupSection activeWallet={{ id: 'wallet-1', name: 'Wallet' }} />
        </MessagingProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Test…' }));
    fireEvent.change(screen.getByLabelText('Recovery phrase to test'), {
        target: { value: 'abandon abandon abandon' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }));
    await screen.findByRole('button', { name: 'Run test' });
    return messaging;
}

describe('BackupSection dry-run error copy', () => {
    it('tells the user to check the phrase when it fails validation', async () => {
        const messaging = await runWith(hydrated(
            'InvalidMnemonicError',
            'importMnemonic: bip39 validation failed (checksum or word-list validation failed)',
        ));
        expect(messaging.dryRunRestoreRequest).toHaveBeenCalledTimes(1);
        expect(await screen.findByText(/That recovery phrase isn't valid/)).toBeTruthy();
        expect(document.body.textContent).not.toMatch(/importMnemonic:|bip39 validation|checksum/);
    });

    it('swaps any other developer-prefixed flow error for the plain fallback', async () => {
        await runWith(new Error('dryRunRestore: gapLimit must be a positive integer ≤ 1000'));
        expect(await screen.findByText('Dry-run restore failed.')).toBeTruthy();
        expect(document.body.textContent).not.toMatch(/dryRunRestore:/);
    });

    it('keeps a message that was already written for the user', async () => {
        await runWith(new Error('The wallet is locked. Unlock it and try again.'));
        expect(await screen.findByText('The wallet is locked. Unlock it and try again.')).toBeTruthy();
    });
});
