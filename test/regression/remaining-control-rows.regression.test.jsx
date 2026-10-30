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
import { DisplaySection } from '../../packages/core/src/shared/components/settings/DisplaySection.jsx';
import { MessagingContext } from '../../packages/core/src/shared/MessagingContext.js';
import buttonStyles from '../../packages/core/src/ui/Button.module.css';
import inputStyles from '../../packages/core/src/ui/Input.module.css';

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
    it('[REGRESSION P1] gives both backup reminder actions the shared small control class', async () => {
        render(<BackupReminderCard walletId="wallet-1" hasFunds onAction={vi.fn()} />);

        expectButtonsUseSize([
            await screen.findByRole('button', { name: 'Back up now' }),
            screen.getByRole('button', { name: 'Remind me tomorrow' }),
        ], 'sm');
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

    it('[REGRESSION P1] gives every watched-token row control the shared medium class', async () => {
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
                <DisplaySection />
            </MessagingContext.Provider>,
        );

        const chain = await screen.findByRole('combobox', { name: 'Token network' });
        expectFieldsUseSize([
            chain,
            screen.getByRole('textbox', { name: 'Token ticker' }),
        ], 'md');
        expectButtonsUseSize([
            screen.getByRole('button', { name: 'Watch token' }),
        ], 'md');
    });

    it('[REGRESSION P1] gives every price-alert row control the shared medium class', () => {
        render(<PriceAlertForm
            initialAlert={{ chainId: 'bitcoin-mainnet', direction: 'below', targetFiat: 65000 }}
            onCreate={vi.fn()}
            onCancel={vi.fn()}
        />);

        expectFieldsUseSize([
            screen.getByRole('combobox', { name: 'Coin' }),
            screen.getByRole('combobox', { name: 'Direction' }),
            screen.getByRole('textbox', { name: 'Target price' }),
        ], 'md');
        expectButtonsUseSize([
            screen.getByRole('button', { name: 'Save changes' }),
            screen.getByRole('button', { name: 'Cancel' }),
        ], 'md');
    });
});
