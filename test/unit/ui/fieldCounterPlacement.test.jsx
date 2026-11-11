// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Input } from '../../../packages/core/src/ui/Input.jsx';
import { Textarea } from '../../../packages/core/src/ui/Textarea.jsx';

const FIELD_CASES = [
    ['Input', Input, 'input'],
    ['Textarea', Textarea, 'textarea'],
];

describe('field counter placement', () => {
    it.each(FIELD_CASES)(
        'keeps the %s counter on the label row while the value changes',
        (_name, Field, controlTag) => {
            render(<Field label="Memo" defaultValue="abc" maxLength={10} />);

            const control = screen.getByLabelText('Memo');
            const counter = screen.getByText('3 / 10');
            const label = screen.getByText('Memo');
            const labelRow = counter.parentElement;

            expect(labelRow).toContainElement(label);
            expect(labelRow).not.toBe(control.parentElement?.parentElement);
            expect(labelRow).not.toContainElement(control);
            expect(labelRow.querySelector(controlTag)).toBeNull();
            expect(counter).toHaveAttribute('aria-live', 'polite');
            expect(control.getAttribute('aria-describedby')?.split(' ')).toContain(counter.id);

            fireEvent.change(control, { target: { value: 'abcd' } });
            expect(screen.getByText('4 / 10')).toBe(counter);
        },
    );

    it.each(FIELD_CASES)(
        'keeps the %s counter on the label row and its field action in the control',
        (_name, Field) => {
            render(
                <Field
                    label="Memo"
                    defaultValue="abc"
                    maxLength={10}
                    fieldAction={<button type="button">Scan</button>}
                />,
            );

            const counter = screen.getByText('3 / 10');
            const action = screen.getByRole('button', { name: 'Scan' });

            expect(counter.parentElement).not.toContainElement(action);
            expect(screen.getByLabelText('Memo').parentElement).toContainElement(action);
        },
    );

    it.each(FIELD_CASES)(
        'orders the %s label, Optional pill, and counter on the label row',
        (_name, Field) => {
            const { container } = render(
                <Field label="Memo" optional defaultValue="abc" maxLength={10} />,
            );
            const counter = screen.getByText('3 / 10');
            const pill = container.querySelector('[data-optional-pill]');

            expect([...counter.parentElement.children]).toEqual([
                screen.getByText('Memo'),
                pill,
                counter,
            ]);
        },
    );

    it.each(FIELD_CASES)(
        'keeps the aria-labelled %s counter after the control',
        (_name, Field) => {
            render(<Field aria-label="Memo" defaultValue="abc" maxLength={10} />);

            const control = screen.getByLabelText('Memo');
            const counter = screen.getByText('3 / 10');
            const field = counter.parentElement;

            expect(field).toContainElement(control);
            expect(control.compareDocumentPosition(counter) & Node.DOCUMENT_POSITION_FOLLOWING)
                .toBeTruthy();
        },
    );

    it('renders a custom Textarea counter on the label row instead of its character count', () => {
        const { rerender } = render(
            <Textarea label="Message" defaultValue="abc" maxLength={10} />,
        );
        const builtInCounterClass = screen.getByText('3 / 10').className;

        rerender(
            <Textarea
                label="Message"
                defaultValue="abc"
                maxLength={10}
                counter={<span>4 / 1,024 bytes.</span>}
            />,
        );

        const control = screen.getByLabelText('Message');
        const counterContent = screen.getByText('4 / 1,024 bytes.');
        const counter = counterContent.parentElement;
        const labelRow = counter.parentElement;

        expect(labelRow).toContainElement(screen.getByText('Message'));
        expect(labelRow).not.toContainElement(control);
        expect(counter.className).toBe(builtInCounterClass);
        expect(counter).toHaveAttribute('aria-live', 'polite');
        expect(control.getAttribute('aria-describedby')?.split(' ')).toContain(counter.id);
        expect(screen.queryByText('3 / 10')).toBeNull();
    });

    it('right-aligns only label-row counters and preserves the label-less fallback gap', () => {
        const css = readFileSync('packages/core/src/ui/Input.module.css', 'utf8');
        const counterRule = css.match(/(?:^|\n)\.counter\s*\{([^}]*)\}/s)?.[1] || '';
        const labelRowCounterRule = css.match(/\.labelRow\s*>\s*\.counter\s*\{([^}]*)\}/s)?.[1] || '';
        const fieldCounterRule = css.match(/\.field\s*>\s*\.counter\s*\{([^}]*)\}/s)?.[1] || '';

        expect(counterRule).toMatch(/white-space:\s*nowrap/);
        expect(counterRule).not.toMatch(/margin-block-start|align-self/);
        expect(labelRowCounterRule).toMatch(/flex:\s*none/);
        expect(labelRowCounterRule).toMatch(/margin-inline-start:\s*auto/);
        expect(fieldCounterRule).toMatch(/margin-block-start:\s*var\(--xc-help-gap\)/);
        expect(fieldCounterRule).toMatch(/align-self:\s*flex-end/);
    });
});
