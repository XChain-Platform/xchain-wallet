// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SegmentedControl } from '../../../packages/core/src/ui/SegmentedControl.jsx';

function ThreeWaySegmentedControl() {
    const [value, setValue] = useState('first');
    return (
        <SegmentedControl
            aria-label="View mode"
            value={value}
            onChange={setValue}
            items={[
                { id: 'first', label: 'First' },
                { id: 'disabled', label: 'Disabled', disabled: true },
                { id: 'third', label: 'Third' },
            ]}
        />
    );
}

describe('SegmentedControl', () => {
    it('exposes one roving radio choice and skips disabled items with arrow keys', () => {
        render(<ThreeWaySegmentedControl />);
        const first = screen.getByRole('radio', { name: 'First' });
        const disabled = screen.getByRole('radio', { name: 'Disabled' });
        const third = screen.getByRole('radio', { name: 'Third' });

        expect(screen.getByRole('radiogroup', { name: 'View mode' })).toBeInTheDocument();
        expect(first).toHaveAttribute('aria-checked', 'true');
        expect(first).toHaveAttribute('tabindex', '0');
        expect(disabled).toBeDisabled();
        expect(disabled).toHaveAttribute('tabindex', '-1');

        first.focus();
        fireEvent.keyDown(first, { key: 'ArrowRight' });
        expect(third).toHaveFocus();
        expect(third).toHaveAttribute('aria-checked', 'true');
        expect(first).toHaveAttribute('tabindex', '-1');

        fireEvent.keyDown(third, { key: 'ArrowRight' });
        expect(first).toHaveFocus();
        fireEvent.keyDown(first, { key: 'End' });
        expect(third).toHaveFocus();
        fireEvent.keyDown(third, { key: 'Home' });
        expect(first).toHaveFocus();
    });

    it('uses shared geometry and semantic selected tones', () => {
        const css = readFileSync('packages/core/src/ui/SegmentedControl.module.css', 'utf8');

        expect(css).toMatch(/\.segmented\s*\{[^}]*height:\s*var\(--xc-control-h-md\)/s);
        expect(css).toMatch(/\.segmented\s*\{[^}]*border-radius:\s*var\(--xc-control-radius\)/s);
        expect(css).toMatch(/data-tone='success'[^}]*var\(--xc-success-fill\)/s);
        expect(css).toMatch(/data-tone='danger'[^}]*var\(--xc-danger\)/s);
    });
});
