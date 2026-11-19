// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Textarea } from '../../../packages/core/src/ui/Textarea.jsx';

describe('<Textarea> optional fields', () => {
    it.each([
        ['the optional prop', <Textarea key="prop" label="Memo" optional />],
        ['an optional suffix', <Textarea key="suffix" label="Memo (optional)" />],
        ['the optional prop and suffix', <Textarea key="both" label="Memo (OPTIONAL)" optional />],
    ])('renders one described pill with %s', (_case, field) => {
        const { container } = render(field);
        const textarea = screen.getByLabelText('Memo');
        const pill = container.querySelector('[data-optional-pill]');

        expect(screen.queryByText(/\(optional\)/i)).toBeNull();
        expect(container.querySelectorAll('[data-optional-pill]')).toHaveLength(1);
        expect(pill).toHaveTextContent('Optional');
        expect(pill.closest('label')).toBeNull();
        expect(textarea).toHaveAttribute('aria-required', 'false');
        expect(textarea.getAttribute('aria-describedby')?.split(' ')).toContain(pill.id);
    });

    it('lets required override the optional prop and a leftover suffix', () => {
        const { container } = render(
            <Textarea label="Memo (optional)" optional required />,
        );

        expect(screen.getByLabelText('Memo')).toHaveAttribute('aria-required', 'true');
        expect(screen.queryByText(/\(optional\)/i)).toBeNull();
        expect(container.querySelector('[data-optional-pill]')).toBeNull();
    });

    it('keeps a field action inside the control and reserves trailing space', () => {
        render(
            <Textarea
                label="Memo"
                fieldAction={<button type="button">Scan</button>}
            />,
        );

        const textarea = screen.getByLabelText('Memo');
        const action = screen.getByRole('button', { name: 'Scan' });
        expect(textarea.parentElement).toContainElement(action);
        expect(textarea.className).toContain('inputWithFieldAction');
        expect(document.querySelector(`label[for="${textarea.id}"]`)).not.toContainElement(action);
    });
});
