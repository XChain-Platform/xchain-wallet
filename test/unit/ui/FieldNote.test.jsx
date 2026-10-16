// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { FieldNote } from '../../../packages/core/src/ui/FieldNote.jsx';
import { FormPage } from '../../../packages/core/src/ui/FormPage.jsx';

afterEach(cleanup);

describe('<FieldNote>', () => {
    it('stays where it is written inside a form, as an alert that is not a notice box', () => {
        const { container } = render(
            <FormPage actions={<button type="submit">Go</button>}>
                <input aria-label="Destination" />
                <FieldNote>Looks like a lookalike address</FieldNote>
            </FormPage>,
        );
        const note = screen.getByRole('alert');
        expect(note).toHaveTextContent('Looks like a lookalike address');
        expect(container.querySelector('form')).toContainElement(note);
        expect(note).not.toHaveAttribute('data-variant');
    });

    it('renders one paragraph per line', () => {
        render(<FieldNote variant="error" lines={['One', 'Two']} />);
        expect(screen.getByText('One').tagName).toBe('P');
        expect(screen.getByRole('alert')).toContainElement(screen.getByText('Two'));
    });

    it('renders nothing when empty and drops the role on request', () => {
        const { container, rerender } = render(<FieldNote>{null}</FieldNote>);
        expect(container).toBeEmptyDOMElement();
        rerender(<FieldNote role={null}>Static</FieldNote>);
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByText('Static')).toBeInTheDocument();
    });

    it('draws a recovery action inside the note, under its text', () => {
        render(<FieldNote variant="error" action={<button type="button">Clear</button>}>Unreadable</FieldNote>);
        const note = screen.getByRole('alert');
        expect(note).toContainElement(screen.getByRole('button', { name: 'Clear' }));
        expect(note).toHaveTextContent('Unreadable');
    });
});
