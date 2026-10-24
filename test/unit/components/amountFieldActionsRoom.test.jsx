// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The amount input keeps its digits clear of Max at every text size: the room
// it reserves follows where the action really is, not the
// default-text lanes alone.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
    AmountField,
    syncAmountActionsRoom,
} from '../../../packages/core/src/shared/components/AmountField.jsx';

function box(left, width) {
    return { getBoundingClientRect: () => ({ left, right: left + width, width, top: 0, bottom: 36, height: 36 }) };
}

describe('amount field action room', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        document.body.replaceChildren();
    });

    it('reserves from the input end edge to the first action, plus the 4px gap', () => {
        const wrap = document.createElement('div');
        document.body.appendChild(wrap);
        // 150% text on a 411px phone: input 12..399, Max at 329.
        const room = syncAmountActionsRoom(wrap, box(12, 387), [box(329, 66)]);
        expect(room).toBe(74);
        expect(wrap.style.getPropertyValue('--amount-actions-room')).toBe('74px');
    });

    it('measures from the start edge when the field runs right to left', () => {
        const wrap = document.createElement('div');
        wrap.style.direction = 'rtl';
        document.body.appendChild(wrap);
        expect(syncAmountActionsRoom(wrap, box(12, 387), [box(16, 66)])).toBe(74);
    });

    it('writes nothing when there is no action or no laid-out input', () => {
        const wrap = document.createElement('div');
        expect(syncAmountActionsRoom(wrap, box(0, 0), [box(10, 20)])).toBeNull();
        expect(syncAmountActionsRoom(wrap, box(12, 387), [null, box(0, 0)])).toBeNull();
        expect(syncAmountActionsRoom(wrap, null, [box(10, 20)])).toBeNull();
        expect(wrap.style.getPropertyValue('--amount-actions-room')).toBe('');
    });

    it('pads the input to whichever is larger, the default lanes or the measured room', () => {
        render(<AmountField amount="" tick="BTC" onAmountFieldChange={() => {}} onMax={() => {}} />);
        expect(screen.getByRole('textbox', { name: /^Amount/ }).style.paddingInlineEnd)
            .toBe('max(var(--amount-action-width), var(--amount-actions-room, 0px))');
    });
});
