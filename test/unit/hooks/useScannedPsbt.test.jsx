// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: a scanned PSBT seeds Sign PSBT for that visit only. Leaving the
// screen drops it, so Sign PSBT opened later from the menu starts empty.

import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useScannedPsbt } from '../../../packages/core/src/shared/hooks/useScannedPsbt.js';

describe('useScannedPsbt', () => {
    it('hands a scan to Sign PSBT, then drops it once the user leaves', () => {
        const { result, rerender } = renderHook(({ view }) => useScannedPsbt(view), {
            initialProps: { view: 'scan' },
        });

        // The scan outcome sets the PSBT and switches the view in one handler.
        act(() => {
            result.current[1]('70736274ff01');
            rerender({ view: 'sign-psbt' });
        });
        expect(result.current[0]).toBe('70736274ff01');

        rerender({ view: 'actions' });
        expect(result.current[0]).toBeNull();

        rerender({ view: 'sign-psbt' });
        expect(result.current[0]).toBeNull();
    });

    it('never offers a scan to any other screen', () => {
        const { result } = renderHook(() => useScannedPsbt('home'));
        act(() => { result.current[1]('70736274ff01'); });
        expect(result.current[0]).toBeNull();
    });
});
