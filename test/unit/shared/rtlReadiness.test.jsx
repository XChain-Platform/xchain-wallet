// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AmountField } from '../../../packages/core/src/shared/components/AmountField.jsx';
import { AddressField } from '../../../packages/core/src/ui/AddressField.jsx';
import { AddressText } from '../../../packages/core/src/ui/AddressText.jsx';
import { BackIcon, ForwardIcon, MigrateIcon } from '../../../packages/core/src/ui/icons/index.jsx';
import { Input } from '../../../packages/core/src/ui/Input.jsx';

const tokens = readFileSync(
    join(process.cwd(), 'packages/core/src/ui/tokens.css'),
    'utf8',
);

describe('RTL-safe machine-readable fields', () => {
    it('keeps numeric inputs LTR while preserving direction for prose inputs', () => {
        render(
            <>
                <Input label="Amount" inputMode="decimal" />
                <Input label="Count" inputMode="numeric" />
                <Input label="Name" />
                <Input label="Override" inputMode="numeric" dir="rtl" />
            </>,
        );

        expect(screen.getByLabelText('Amount')).toHaveAttribute('dir', 'ltr');
        expect(screen.getByLabelText('Count')).toHaveAttribute('dir', 'ltr');
        expect(screen.getByLabelText('Name')).not.toHaveAttribute('dir');
        expect(screen.getByLabelText('Override')).toHaveAttribute('dir', 'rtl');
        expect(tokens).toMatch(
            /input\[type='number'\][^{]*input\[inputmode='numeric'\][^{]*input\[inputmode='decimal'\][^{]*\{[^}]*direction:\s*ltr/s,
        );
    });

    it('keeps address entry and display LTR', () => {
        const address = 'bc1q1234567890abcdefghijklmnopqrstuvwxyz';
        render(
            <>
                <AddressField label="Destination" value={address} onChange={() => {}} />
                <AddressText address={address} />
            </>,
        );

        expect(screen.getByLabelText('Destination')).toHaveAttribute('dir', 'ltr');
        expect(screen.getByLabelText(address)).toHaveAttribute('dir', 'ltr');
    });

    it('uses logical padding for the trailing Max control', () => {
        render(
            <AmountField
                amount="1"
                tick="BTC"
                onAmountFieldChange={() => {}}
                onMax={() => {}}
            />,
        );

        const input = screen.getByRole('textbox', { name: 'Amount (BTC)' });
        expect(input.style.paddingInlineEnd).toBe('64px');
        expect(input.style.paddingRight).toBe('');
        expect(input).toHaveAttribute('dir', 'ltr');
    });
});

describe('RTL-safe directional icons', () => {
    it('marks horizontal navigation icons and mirrors them under an RTL root', () => {
        const { container } = render(
            <>
                <BackIcon />
                <ForwardIcon />
                <MigrateIcon />
            </>,
        );

        expect(container.querySelectorAll('svg[data-xc-directional]')).toHaveLength(3);
        expect(tokens).toMatch(
            /\[dir='rtl'\][^{]*svg\[data-xc-directional\][^{]*\{[^}]*transform:\s*scaleX\(-1\)/s,
        );
    });
});
