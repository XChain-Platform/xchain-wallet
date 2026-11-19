// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { ScanRoute } from '../../../packages/core/src/shared/routes/ScanRoute.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

afterEach(cleanup);

describe('Scan route UI rulings', () => {
    it('uses a green icon action for pasted text that stays enabled while the field is empty (G22)', () => {
        render(<ScanRoute onClassified={() => {}} />);

        const submit = screen.getByRole('button', { name: 'Use Pasted Text' });
        expect(submit).toBeEnabled();
        expect(submit.classList.contains(buttonStyles.success)).toBe(true);
        expect(submit.querySelector('svg')).toBeTruthy();
    });

    it('marks the empty paste field red with its own message and clears it once filled', () => {
        const onClassified = vi.fn();
        render(<ScanRoute onClassified={onClassified} />);

        fireEvent.click(screen.getByRole('button', { name: 'Use Pasted Text' }));
        const field = screen.getByPlaceholderText('xchain:… / bitcoin:… / address / transaction code');
        expect(field).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByText('Paste something first.')).toBeInTheDocument();
        expect(document.activeElement).toBe(field);
        expect(onClassified).not.toHaveBeenCalled();

        fireEvent.change(field, { target: { value: 'x' } });
        expect(field).not.toHaveAttribute('aria-invalid', 'true');
        expect(screen.queryByText('Paste something first.')).toBeNull();
    });

    it('explains accepted paste values and the next step from the field label', () => {
        render(<ScanRoute onClassified={() => {}} />);

        expect(screen.getByPlaceholderText('xchain:… / bitcoin:… / address / transaction code')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'About Or paste it here' }));
        expect(screen.getByRole('tooltip')).toHaveTextContent(
            'Paste an xchain: or bitcoin: payment link, an address, or a transaction code. The wallet will identify it and open the matching next step.',
        );
    });
});
