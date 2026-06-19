// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit tests for the per-form native-coin fee toggle.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { NativeFeeToggle } from '../../../packages/core/src/shared/components/NativeFeeToggle.jsx';

afterEach(() => cleanup());

describe('NativeFeeToggle', () => {
    it('renders a plain-language label naming the coin when coinTicker is set', () => {
        render(<NativeFeeToggle checked={false} onChange={() => {}} coinTicker="BTC" />);
        expect(screen.getByText('Pay protocol fee in BTC instead of XCHAIN')).toBeTruthy();
        // The forfeiture hint is surfaced inline.
        expect(screen.getByText(/not refunded if the network rejects/i)).toBeTruthy();
    });

    it('renders nothing when coinTicker is empty (unknown/custom chain)', () => {
        const { container } = render(
            <NativeFeeToggle checked={false} onChange={() => {}} coinTicker="" />,
        );
        expect(container.firstChild).toBeNull();
    });

    it('reflects the checked state and reports toggles via onChange', () => {
        const onChange = vi.fn();
        render(<NativeFeeToggle checked={false} onChange={onChange} coinTicker="DOGE" />);
        const sw = screen.getByRole('switch');
        expect(sw.checked).toBe(false);
        fireEvent.click(sw);
        expect(onChange).toHaveBeenCalledWith(true);
    });
});
