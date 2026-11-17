// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: remaining mixed control rows.
//
//   [P1] 2026-10-13: Native and shared-kit controls render at different
//        heights when a row does not select one shared control size.

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AmountField } from '../../packages/core/src/shared/components/AmountField.jsx';
import { BackupReminderCard } from '../../packages/core/src/shared/components/BackupReminderCard.jsx';
import { PriceAlertForm } from '../../packages/core/src/shared/components/PriceAlertForm.jsx';
import { AddWatchedTokenSection } from '../../packages/core/src/shared/components/settings/AddWatchedTokenSection.jsx';
import { MessagingContext } from '../../packages/core/src/shared/MessagingContext.js';
import buttonStyles from '../../packages/core/src/ui/Button.module.css';
import inputStyles from '../../packages/core/src/ui/Input.module.css';
import iconSelectStyles from '../../packages/core/src/ui/IconSelect.module.css';
import tokenFieldStyles from '../../packages/core/src/shared/components/TokenField.module.css';

function expectButtonsUseSize(buttons, size) {
    for (const button of buttons) {
        expect(button).toHaveClass(buttonStyles.btn, buttonStyles[size]);
    }
}

function expectFieldsUseSize(fields, size) {
    for (const field of fields) {
        expect(field.closest(`.${inputStyles.field}`)).toHaveClass(inputStyles[size]);
    }
}

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    cleanup();
});

describe('regression/remaining-control-rows', () => {
    it('[REGRESSION P1] gives the backup reminder action the shared small control class', async () => {
        render(<BackupReminderCard walletId="wallet-1" hasFunds onAction={vi.fn()} />);

        // The reminder is a kit Notice (the Notice Standard): its one action
        // is the shared small Button, and the snooze is the Notice's own X
        // (a 24px tap target drawn by the kit), no longer a second button.
        expectButtonsUseSize([await screen.findByRole('button', { name: 'Back Up Now' })], 'sm');
        expect(screen.getByRole('button', { name: 'Remind Me Tomorrow' }).closest('[data-tone]')).not.toBeNull();
    });

    it('[REGRESSION P1] gives the shared Send and Receive amount-line controls the small class', () => {
        render(<AmountField
            amount="2"
            tick="BTC"
            fiatRate={{ rate: 67000, fiatCurrency: 'USD' }}
            onAmountFieldChange={vi.fn()}
            toggleAmountInputMode={vi.fn()}
        />);

        expectButtonsUseSize([
            screen.getByRole('button', { name: 'Switch input to USD' }),
        ], 'sm');
    });

    it('[REGRESSION P1] gives the Add Watched Token search the shared medium class', async () => {
        const settings = {
            privacy: { hideSmallBalances: false },
            pinnedTokens: [],
            watchedTokens: [],
            hiddenTokens: [],
            showPinAffordance: false,
            showHideAffordance: false,
            smallBalanceThreshold: 'dust',
            numberFormat: 'full',
        };
        const messaging = {
            getSettings: vi.fn().mockResolvedValue(settings),
            updateSettings: vi.fn().mockResolvedValue(settings),
            getTokenInfo: vi.fn().mockResolvedValue({ canonicalTick: null }),
        };
        render(
            <MessagingContext.Provider value={{ shell: 'web', messaging }}>
                <AddWatchedTokenSection />
            </MessagingContext.Provider>,
        );

        expectFieldsUseSize([
            await screen.findByRole('searchbox', { name: 'Search tokens to watch' }),
        ], 'md');
    });

    // 2026-11-14: the price alert page was rebuilt as a Form Standard form
    // (PriceAlertsSection): the Coin select became the Asset token field, the
    // Direction select the When the price dropdown, and the Add and Cancel
    // row gave way to the form's one submit action.
    it('[REGRESSION P1] gives every price-alert field the shared medium size', () => {
        render(<PriceAlertForm
            initialAlert={{ chainId: 'bitcoin-mainnet', direction: 'below', targetFiat: 65000 }}
            onCreate={vi.fn()}
            onCancel={vi.fn()}
        />);

        const asset = screen.getByRole('button', { name: /^Asset: / });
        expect(asset.closest(`.${tokenFieldStyles.field}`)).not.toHaveClass(tokenFieldStyles.lg);
        const direction = screen.getByRole('button', { name: /^When the price: / });
        expect(direction.closest(`.${iconSelectStyles.wrap}`)).toHaveClass(iconSelectStyles.md);
        expectFieldsUseSize([
            screen.getByRole('textbox', { name: 'Target price' }),
        ], 'md');
    });
});
