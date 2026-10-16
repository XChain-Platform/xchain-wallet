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
import { FormNotice } from '../../../packages/core/src/ui/FormNotice.jsx';
import { FormPage } from '../../../packages/core/src/ui/FormPage.jsx';

afterEach(cleanup);

describe('<FormNotice>', () => {
    it('renders in place outside a FormPage', () => {
        render(<FormNotice>Heads up</FormNotice>);
        expect(screen.getByText('Heads up')).toBeInTheDocument();
    });

    it('shows a notice written mid-form as the first item of the page, above the form', () => {
        const { container } = render(
            <FormPage actions={<button type="submit">Go</button>}>
                <input aria-label="Amount" />
                <FormNotice variant="warning">Heads up</FormNotice>
                <input aria-label="Memo" />
            </FormPage>,
        );
        const form = container.querySelector('form');
        expect(form.previousElementSibling).toContainElement(screen.getByText('Heads up'));
        expect(form).not.toContainElement(screen.getByText('Heads up'));
        expect(screen.getAllByText('Heads up')).toHaveLength(1);
    });

    it('lifts a message of several lines as one notice with a paragraph per line', () => {
        const { container } = render(
            <FormPage actions={<button type="submit">Go</button>}>
                <input aria-label="Amount" />
                <FormNotice variant="warning" lines={['First warning', 'Second warning']} />
            </FormPage>,
        );
        const form = container.querySelector('form');
        const first = screen.getByText('First warning');
        expect(form).not.toContainElement(first);
        expect(first.tagName).toBe('P');
        const box = first.closest('[data-variant]');
        expect(box).toContainElement(screen.getByText('Second warning'));
        expect(container.querySelectorAll('[data-variant]')).toHaveLength(1);
    });

    it('takes a list of status notices above the form and shows nothing for an all-empty list', () => {
        const { container, rerender } = render(
            <FormPage status={[null, <p key="a">Draft saved</p>, false]}>
                <input aria-label="Amount" />
            </FormPage>,
        );
        const form = container.querySelector('form');
        expect(form.previousElementSibling).toContainElement(screen.getByText('Draft saved'));
        rerender(
            <FormPage status={[null, false]}>
                <input aria-label="Amount" />
            </FormPage>,
        );
        expect(container.querySelector('form').previousElementSibling).toBeNull();
    });

    it('opens a lifted notice with its bold lead-in', () => {
        const { container } = render(
            <FormPage actions={<button type="submit">Go</button>}>
                <input aria-label="Amount" />
                <FormNotice variant="warning" lead="Destroy is irreversible.">The burned amount cannot be recovered.</FormNotice>
            </FormPage>,
        );
        const lead = screen.getByText('Destroy is irreversible.');
        expect(lead.tagName).toBe('STRONG');
        expect(container.querySelector('form')).not.toContainElement(lead);
        expect(lead.closest('[data-variant]')).toHaveTextContent('Destroy is irreversible. The burned amount cannot be recovered.');
    });

    it('opens the first of several lines with the bold lead-in, in place and lifted', () => {
        const { unmount } = render(<FormNotice lead="Heads up." lines={['First line.', 'Second line.']} />);
        let lead = screen.getByText('Heads up.');
        expect(lead.tagName).toBe('STRONG');
        expect(lead.closest('p')).toHaveTextContent('Heads up. First line.');
        unmount();
        render(
            <FormPage>
                <FormNotice lead="Heads up." lines={['First line.', 'Second line.']} />
            </FormPage>,
        );
        lead = screen.getByText('Heads up.');
        expect(lead.closest('p')).toHaveTextContent('Heads up. First line.');
        expect(screen.getByText('Second line.').tagName).toBe('P');
    });

    it('renders nothing for an empty list of lines', () => {
        const { container } = render(
            <FormPage><FormNotice lines={[]} /></FormPage>,
        );
        expect(container.querySelector('[data-variant]')).toBeNull();
    });

    it('renders lines in place outside a FormPage', () => {
        render(<FormNotice lines={['One', 'Two']} />);
        expect(screen.getByText('One').closest('[data-variant]')).toContainElement(screen.getByText('Two'));
    });

    it('withdraws the notice when it stops rendering', () => {
        const { rerender } = render(
            <FormPage><FormNotice>Heads up</FormNotice></FormPage>,
        );
        expect(screen.getByText('Heads up')).toBeInTheDocument();
        rerender(<FormPage><FormNotice>{null}</FormNotice></FormPage>);
        expect(screen.queryByText('Heads up')).toBeNull();
    });
});
