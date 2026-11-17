// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The memo is a textarea one line tall that grows with its text to three
// lines, then scrolls inside (operator ruling). The height rule, the Textarea
// autoGrow wiring and the MemoSection field (name, cap, header count, Enter).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Textarea } from '../../../packages/core/src/ui/Textarea.jsx';
import { autoGrowSize } from '../../../packages/core/src/ui/textareaAutoGrow.js';
import { MEMO_MAX_ROWS, MemoSection } from '../../../packages/core/src/shared/components/formStandard/MemoSection.jsx';

const LINE = 20;
const PADDING = 16;
const BORDER = 2;
const lines = (n) => n * LINE + PADDING;

describe('autoGrowSize', () => {
    const size = (n, maxRows = 3) => autoGrowSize({
        scrollHeight: lines(n), lineHeight: LINE, paddingBlock: PADDING, borderBlock: BORDER, maxRows,
    });

    it('fits one line without scrolling', () => {
        expect(size(1)).toEqual({ height: lines(1) + BORDER, overflowY: 'hidden' });
    });

    it('grows with each line up to the cap', () => {
        expect(size(2)).toEqual({ height: lines(2) + BORDER, overflowY: 'hidden' });
        expect(size(3)).toEqual({ height: lines(3) + BORDER, overflowY: 'hidden' });
    });

    it('stops at the cap and scrolls inside past it', () => {
        expect(size(4)).toEqual({ height: lines(3) + BORDER, overflowY: 'auto' });
        expect(size(12)).toEqual({ height: lines(3) + BORDER, overflowY: 'auto' });
    });

    it('takes subpixel rounding at the cap as fitting', () => {
        const at = autoGrowSize({
            scrollHeight: lines(3) + 0.4, lineHeight: LINE, paddingBlock: PADDING, borderBlock: BORDER, maxRows: 3,
        });
        expect(at.overflowY).toBe('hidden');
    });

    it('never caps below one line', () => {
        expect(size(2, 0)).toEqual({ height: lines(1) + BORDER, overflowY: 'auto' });
    });
});

describe('<Textarea autoGrow>', () => {
    let scrollHeight = lines(1);
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    beforeEach(() => {
        Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
            configurable: true,
            get() { return scrollHeight; },
        });
    });
    afterEach(() => {
        delete HTMLTextAreaElement.prototype.scrollHeight;
        if (descriptor) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', descriptor);
    });
    // Inline metrics stand in for the stylesheet, which the unit run does not load.
    const metrics = { lineHeight: `${LINE}px`, paddingTop: '8px', paddingBottom: '8px', borderTopWidth: '1px', borderBottomWidth: '1px', borderStyle: 'solid' };

    it('starts one row tall with no resize grip', () => {
        render(<Textarea aria-label="Note" autoGrow value="" onChange={() => {}} />);
        const field = screen.getByRole('textbox', { name: 'Note' });
        expect(field.tagName).toBe('TEXTAREA');
        expect(field).toHaveAttribute('rows', '1');
        expect(field.style.resize).toBe('none');
    });

    it('keeps the browser rows and the grip without autoGrow', () => {
        render(<Textarea aria-label="Note" value="" onChange={() => {}} />);
        const field = screen.getByRole('textbox', { name: 'Note' });
        expect(field).not.toHaveAttribute('rows');
        expect(field.style.resize).toBe('vertical');
    });

    it('grows to three lines, then holds and scrolls', () => {
        scrollHeight = lines(1);
        const { rerender } = render(<Textarea aria-label="Note" autoGrow style={metrics} value="a" onChange={() => {}} />);
        const field = screen.getByRole('textbox', { name: 'Note' });
        expect(field.style.height).toBe(`${lines(1) + BORDER}px`);
        expect(field.style.overflowY).toBe('hidden');

        scrollHeight = lines(3);
        rerender(<Textarea aria-label="Note" autoGrow style={metrics} value="a b c" onChange={() => {}} />);
        expect(field.style.height).toBe(`${lines(3) + BORDER}px`);
        expect(field.style.overflowY).toBe('hidden');

        scrollHeight = lines(5);
        rerender(<Textarea aria-label="Note" autoGrow style={metrics} value="a b c d e" onChange={() => {}} />);
        expect(field.style.height).toBe(`${lines(3) + BORDER}px`);
        expect(field.style.overflowY).toBe('auto');
    });

    it('leaves the CSS height alone while not laid out (a closed section)', () => {
        scrollHeight = 0;
        render(<Textarea aria-label="Note" autoGrow style={metrics} value="a" onChange={() => {}} />);
        expect(screen.getByRole('textbox', { name: 'Note' }).style.height).toBe('');
    });
});

function Memo({ maxLength, onSubmit = () => {}, onKeyDown }) {
    const [memo, setMemo] = useState('');
    return (
        <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
            <MemoSection
                defaultOpen
                type="text"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                onKeyDown={onKeyDown}
                {...(maxLength ? { maxLength } : {})}
            />
            <button type="submit">Send</button>
        </form>
    );
}

describe('MemoSection memo field', () => {
    it('is a one-row textarea named Memo, capped at 250, three rows at most', () => {
        render(<Memo />);
        const field = screen.getByRole('textbox', { name: 'Memo' });
        expect(field.tagName).toBe('TEXTAREA');
        expect(field).toHaveAttribute('rows', '1');
        expect(field).toHaveAttribute('maxLength', '250');
        expect(field).not.toHaveAttribute('type');
        expect(MEMO_MAX_ROWS).toBe(3);
    });

    it('keeps a form limit and counts in the section header', () => {
        const { container } = render(<Memo maxLength={80} />);
        const field = screen.getByRole('textbox', { name: 'Memo' });
        expect(field).toHaveAttribute('maxLength', '80');
        const count = container.querySelector('[data-memo-count]');
        expect(count).toHaveTextContent('0 / 80');
        expect(field.getAttribute('aria-describedby')?.split(' ')).toContain(count.id);
        fireEvent.change(field, { target: { value: 'hello' } });
        expect(count).toHaveTextContent('5 / 80');
        expect(count.closest('[data-form-section-toggle]')).not.toBeNull();
        // The field's own counter is hidden, so it names only drawn elements.
        for (const ref of field.getAttribute('aria-describedby').split(' ')) {
            expect(document.getElementById(ref), ref).not.toBeNull();
        }
    });

    it('turns pasted line breaks into spaces before the host sees the value', () => {
        render(<Memo />);
        const field = screen.getByRole('textbox', { name: 'Memo' });
        fireEvent.change(field, { target: { value: 'a\nb\r\nc\rd' } });
        expect(field).toHaveValue('a b c d');
    });

    it('takes Enter as neither a line break nor a submit, and still tells the host', () => {
        const onSubmit = vi.fn();
        const onKeyDown = vi.fn();
        render(<Memo onSubmit={onSubmit} onKeyDown={onKeyDown} />);
        const field = screen.getByRole('textbox', { name: 'Memo' });
        const notCancelled = fireEvent.keyDown(field, { key: 'Enter' });
        expect(notCancelled).toBe(false);
        expect(onSubmit).not.toHaveBeenCalled();
        expect(onKeyDown).toHaveBeenCalledTimes(1);
        // Other keys pass through untouched.
        expect(fireEvent.keyDown(field, { key: 'a' })).toBe(true);
    });
});
