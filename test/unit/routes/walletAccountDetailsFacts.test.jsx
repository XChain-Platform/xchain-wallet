// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Wallet Details and Account Details share one identity card and one Details
// card: the card sits 8px in (G80), the Active bubble is My Wallets' (G07),
// and every fact is a label-left, value-right row with no uppercase label (G14).

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AccountDetails } from '../../../packages/core/src/shared/routes/AccountDetails.jsx';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';

const css = readFileSync('packages/core/src/shared/routes/WalletPicker.module.css', 'utf8');
const rule = (selector) => css.match(new RegExp(`\\${selector}\\s*\\{([^}]+)\\}`))?.[1] || '';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('Wallet and Account Details facts', () => {
    it('draws every fact label left and value right, 8px in, with no uppercase label', () => {
        expect(rule('.detailRow')).toMatch(/display:\s*flex/);
        expect(rule('.detailRow')).toMatch(/justify-content:\s*space-between/);
        expect(rule('.detailRow')).toMatch(/padding:\s*var\(--xc-space-2\);/);
        expect(rule('.detailValue')).toMatch(/text-align:\s*end/);
        expect(rule('.detailLabel')).not.toMatch(/uppercase|letter-spacing/);
    });

    it('sets both identity cards 8px in and uses the My Wallets Active bubble', () => {
        for (const file of ['WalletDetails.jsx', 'AccountDetails.jsx']) {
            const source = readFileSync(`packages/core/src/shared/routes/${file}`, 'utf8');
            const card = source.match(/data-identity-card=""[^\n]*/)?.[0] || '';
            expect(card, file).toMatch(/padding: 'var\(--xc-space-2\)'/);
            expect(card, file).not.toMatch(/--xc-space-3/);
            expect(source, file).toMatch(/className=\{pickerStyles\.activeBadge\}/);
            expect(source, file).not.toMatch(/borderRadius: '999px'/);
        }
    });

    it('renders Account Details facts as the shared label and value rows', async () => {
        const messaging = { listAccounts: vi.fn().mockResolvedValue([{ id: 'account-1', name: 'Spending', index: 0 }]) };
        render(
            <MessagingContext.Provider value={{ messaging, shell: 'web' }}>
                <AccountDetails walletId="wallet-1" accountId="account-1" activeAccountId="account-1" onBack={() => {}} />
            </MessagingContext.Provider>,
        );
        fireEvent.click(await screen.findByRole('tab', { name: /Details/ }));
        const details = screen.getByLabelText('Account details');
        expect(details.tagName).toBe('DL');
        const labels = [...details.querySelectorAll('dt')].map((dt) => dt.textContent);
        const values = [...details.querySelectorAll('dd')].map((dd) => dd.textContent);
        expect(labels).toEqual(['Name', 'Account number', 'Status']);
        expect(values).toEqual(['Spending', '1', 'Active']);
    });
});
