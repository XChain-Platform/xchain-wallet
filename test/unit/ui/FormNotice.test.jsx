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

    // The lifted notice is the form's first item (operator 2026-11-16): inside
    // the one form card from 600px, leading the bare fields below it.
    it('shows a notice written mid-form as the first item of the form, at its top', () => {
        const { container } = render(
            <FormPage actions={<button type="submit">Go</button>}>
                <input aria-label="Amount" />
                <FormNotice variant="warning">Heads up</FormNotice>
                <input aria-label="Memo" />
            </FormPage>,
        );
        const form = container.querySelector('form');
        expect(form.firstElementChild).toHaveAttribute('data-form-status');
        expect(form.firstElementChild).toContainElement(screen.getByText('Heads up'));
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
        expect(form.firstElementChild).toContainElement(first);
        expect(first.tagName).toBe('P');
        const box = first.closest('[data-variant]');
        expect(box).toContainElement(screen.getByText('Second warning'));
        expect(container.querySelectorAll('[data-variant]')).toHaveLength(1);
    });

    it('takes a list of status notices at the top of the form and shows nothing for an all-empty list', () => {
        const { container, rerender } = render(
            <FormPage status={[null, <p key="a">Draft saved</p>, false]}>
                <input aria-label="Amount" />
            </FormPage>,
        );
        const form = container.querySelector('form');
        expect(form.firstElementChild).toHaveAttribute('data-form-status');
        expect(form.firstElementChild).toContainElement(screen.getByText('Draft saved'));
        rerender(
            <FormPage status={[null, false]}>
                <input aria-label="Amount" />
            </FormPage>,
        );
        expect(container.querySelector('[data-form-status]')).toBeNull();
        expect(container.querySelector('form').previousElementSibling).toBeNull();
    });

    it('opens a lifted notice with its block title', () => {
        const { container } = render(
            <FormPage actions={<button type="submit">Go</button>}>
                <input aria-label="Amount" />
                <FormNotice variant="warning" title="Destroy is irreversible.">The burned amount cannot be recovered.</FormNotice>
            </FormPage>,
        );
        const title = screen.getByText('Destroy is irreversible.');
        expect(title.tagName).toBe('DIV');
        expect(title.nextElementSibling).toHaveTextContent('The burned amount cannot be recovered.');
        expect(container.querySelector('form').firstElementChild).toContainElement(title);
    });

    it('keeps a title above several lines, in place and lifted', () => {
        const { unmount } = render(<FormNotice title="Heads up." lines={['First line.', 'Second line.']} />);
        let title = screen.getByText('Heads up.');
        expect(title.tagName).toBe('DIV');
        expect(title.nextElementSibling).toContainElement(screen.getByText('First line.'));
        unmount();
        render(
            <FormPage>
                <FormNotice title="Heads up." lines={['First line.', 'Second line.']} />
            </FormPage>,
        );
        title = screen.getByText('Heads up.');
        expect(title.nextElementSibling).toContainElement(screen.getByText('First line.'));
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
