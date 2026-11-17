// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Input } from '../../../packages/core/src/ui/Input.jsx';
import { Textarea } from '../../../packages/core/src/ui/Textarea.jsx';

function Controlled({ Field, ...props }) {
    const [value, setValue] = useState(props.initial ?? '');
    return <Field {...props} value={value} onChange={(e) => setValue(e.target.value)} />;
}

const CASES = [
    ['Input', Input],
    ['Textarea', Textarea],
];

describe('clearable fields', () => {
    it.each(CASES)('%s shows a named X only while it has text, and the X empties it', (_n, Field) => {
        render(<Controlled Field={Field} label="Name" clearable />);
        const control = screen.getByLabelText('Name');
        expect(screen.queryByRole('button', { name: 'Clear Name' })).toBeNull();

        fireEvent.change(control, { target: { value: 'Treasury' } });
        const x = screen.getByRole('button', { name: 'Clear Name' });
        expect(control.parentElement).toContainElement(x);

        fireEvent.click(x);
        expect(screen.getByLabelText('Name')).toHaveValue('');
        expect(screen.queryByRole('button', { name: 'Clear Name' })).toBeNull();
    });

    it.each(CASES)('%s keeps the same control element when the X appears and goes', (_n, Field) => {
        render(<Controlled Field={Field} label="Name" clearable />);
        const before = screen.getByLabelText('Name');
        fireEvent.change(before, { target: { value: 'a' } });
        expect(screen.getByLabelText('Name')).toBe(before);
        fireEvent.click(screen.getByRole('button', { name: 'Clear Name' }));
        expect(screen.getByLabelText('Name')).toBe(before);
    });

    it.each(CASES)('%s runs onClear instead of the default when given', (_n, Field) => {
        const onClear = vi.fn();
        render(<Field label="Name" clearable onClear={onClear} defaultValue="abc" />);
        fireEvent.click(screen.getByRole('button', { name: 'Clear Name' }));
        expect(onClear).toHaveBeenCalledTimes(1);
        expect(screen.getByLabelText('Name')).toHaveValue('abc');
    });

    it.each(CASES)('%s draws no X when disabled or not clearable', (_n, Field) => {
        const { rerender } = render(<Field label="Name" clearable disabled defaultValue="abc" />);
        expect(screen.queryByRole('button', { name: 'Clear Name' })).toBeNull();
        rerender(<Field label="Name" defaultValue="abc" />);
        expect(screen.queryByRole('button', { name: 'Clear Name' })).toBeNull();
    });

    it.each(CASES)('%s keeps its counter in the label row beside a clear X', (_n, Field) => {
        render(<Field label="Name" clearable defaultValue="abc" counter="3 / 64 bytes" />);
        const counter = screen.getByText('3 / 64 bytes');
        expect(counter.parentElement).toContainElement(screen.getByText('Name'));
        expect(counter.parentElement).not.toContainElement(screen.getByRole('button', { name: 'Clear Name' }));
    });
});

describe('auto-growing Textarea', () => {
    const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    afterEach(() => {
        if (originalScrollHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight);
        else delete HTMLElement.prototype.scrollHeight;
        vi.restoreAllMocks();
    });

    function lines(count) {
        // 20px lines, 10px of block padding in total.
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
            configurable: true,
            get() { return this instanceof HTMLTextAreaElement ? count * 20 + 10 : 0; },
        });
    }

    function mountWithLineMetrics() {
        vi.spyOn(window, 'getComputedStyle').mockReturnValue({
            fontSize: '16px',
            lineHeight: '20px',
            paddingTop: '5px',
            paddingBottom: '5px',
            borderTopWidth: '1px',
            borderBottomWidth: '1px',
        });
        return render(<Textarea label="Description" autoGrow maxRows={3} defaultValue="" />);
    }

    it('starts as one row', () => {
        lines(1);
        mountWithLineMetrics();
        expect(screen.getByLabelText('Description')).toHaveAttribute('rows', '1');
    });

    it('grows from one to three rows as the text wraps, then scrolls inside', () => {
        lines(1);
        mountWithLineMetrics();
        const box = screen.getByLabelText('Description');
        expect(box.style.height).toBe('32px');
        expect(box.style.overflowY).toBe('hidden');

        lines(2);
        fireEvent.change(box, { target: { value: 'two lines' } });
        expect(box.style.height).toBe('52px');
        expect(box.style.overflowY).toBe('hidden');

        lines(3);
        fireEvent.change(box, { target: { value: 'three lines' } });
        expect(box.style.height).toBe('72px');
        expect(box.style.overflowY).toBe('hidden');

        lines(5);
        fireEvent.change(box, { target: { value: 'five lines' } });
        expect(box.style.height).toBe('72px');
        expect(box.style.overflowY).toBe('auto');
    });
});
