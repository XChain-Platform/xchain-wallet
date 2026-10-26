// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A cleared or blank wallet name must import under the default name. The
// vault refuses an empty name, and a blank-but-accepted one leaves a wallet
// the header and the picker cannot tell apart from no wallet.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'correct-horse-battery';

async function importAs(typedName, props = {}) {
    const importMnemonic = vi.fn().mockResolvedValue({});
    render(
        <MessagingProvider shell="web" messaging={{ importMnemonic }}>
            <ImportWallet onBack={() => {}} onImported={() => {}} mode="fresh" {...props} />
        </MessagingProvider>,
    );
    fireEvent.change(screen.getByLabelText('Recovery phrase'), { target: { value: PHRASE } });
    fireEvent.change(screen.getByLabelText('Wallet name'), { target: { value: typedName } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText(/^Confirm/), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(importMnemonic).toHaveBeenCalled());
    return importMnemonic.mock.calls[0][0].name;
}

describe('wallet name on import', () => {
    it('falls back to the default for an empty name', async () => {
        expect(await importAs('')).toBe('Imported Wallet');
    });

    it('falls back to the default for a whitespace-only name', async () => {
        expect(await importAs('     ')).toBe('Imported Wallet');
    });

    it('trims a typed name', async () => {
        expect(await importAs('  Savings  ')).toBe('Savings');
    });

    it('falls back to FreeWallet on the FreeWallet variant', async () => {
        expect(await importAs('   ', { variant: 'freewallet' })).toBe('FreeWallet');
    });
});
