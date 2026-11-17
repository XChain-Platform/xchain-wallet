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
import { BackIcon, ForwardIcon, MigrateIcon, SendIcon } from '../../../packages/core/src/ui/icons/index.jsx';
import { Input } from '../../../packages/core/src/ui/Input.jsx';

const tokens = readFileSync(
    join(process.cwd(), 'packages/core/src/ui/tokens.css'),
    'utf8',
);
const amountFieldStyles = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/components/AmountField.module.css'),
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
        // The AddressText, and the field's own fit display of the address at
        // rest (G99), both read left to right.
        const displays = screen.getAllByLabelText(address);
        expect(displays.length).toBeGreaterThan(0);
        for (const display of displays) expect(display).toHaveAttribute('dir', 'ltr');
    });

    it('places intrinsic-width trailing controls at the logical input end', () => {
        render(
            <AmountField
                amount="1"
                tick="BTC"
                onAmountFieldChange={() => {}}
                onMax={() => {}}
            />,
        );

        // Max is the Input's own in-field icon at its trailing edge. The
        // reserved input padding and the action inset are logical properties,
        // so no physical left or right value is written for either direction.
        const input = screen.getByRole('textbox', { name: 'Amount (BTC)' });
        const max = screen.getByRole('button', { name: 'Use max available amount' });
        expect(input.style.paddingRight).toBe('');
        expect(input.style.paddingLeft).toBe('');
        expect(max.style.position).toBe('');
        expect(max.style.left).toBe('');
        expect(max.style.right).toBe('');
        expect(input).toHaveAttribute('dir', 'ltr');
        // The input is left to right, so under a right-to-left page its inline
        // end is the right edge while the action sits at the left. The
        // stylesheet moves the Input's own field-action room to the inline
        // start, on the input itself, where the Input's G112 action inset
        // (--xc-control-action-inset) resolves.
        expect(amountFieldStyles).toMatch(
            /:global\(html\[dir='rtl'\]\) \.amountFieldWrap input\s*\{[^}]*padding-inline-start:\s*calc\(var\(--xc-control-action-inset\) \+ var\(--xc-tap-min\) \+ var\(--xc-field-icon-gap\)\)[^}]*text-align:\s*end/s,
        );
        expect(amountFieldStyles).not.toMatch(/--amount-end-room/);
    });
});

describe('RTL-safe directional icons', () => {
    it('marks horizontal navigation icons and mirrors them under an RTL root', () => {
        const { container } = render(
            <>
                <BackIcon />
                <ForwardIcon />
                <MigrateIcon />
                <SendIcon />
            </>,
        );

        expect(container.querySelectorAll('svg[data-xc-directional]')).toHaveLength(4);
        expect(tokens).toMatch(
            /\[dir='rtl'\][^{]*svg\[data-xc-directional\][^{]*\{[^}]*transform:\s*scaleX\(-1\)/s,
        );
    });
});
