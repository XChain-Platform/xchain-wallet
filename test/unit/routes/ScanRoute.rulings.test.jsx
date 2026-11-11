// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { ScanRoute } from '../../../packages/core/src/shared/routes/ScanRoute.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

afterEach(cleanup);

describe('Scan route UI rulings', () => {
    it('uses a green icon action for pasted text, including while disabled', () => {
        render(<ScanRoute onClassified={() => {}} />);

        const submit = screen.getByRole('button', { name: 'Use pasted text' });
        expect(submit).toBeDisabled();
        expect(submit.classList.contains(buttonStyles.success)).toBe(true);
        expect(submit.querySelector('svg')).toBeTruthy();
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
