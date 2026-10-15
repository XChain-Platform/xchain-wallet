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

    it('shows a notice written mid-form as the first item of the form', () => {
        const { container } = render(
            <FormPage actions={<button type="submit">Go</button>}>
                <input aria-label="Amount" />
                <FormNotice variant="warning">Heads up</FormNotice>
                <input aria-label="Memo" />
            </FormPage>,
        );
        const form = container.querySelector('form');
        expect(form.firstElementChild).toContainElement(screen.getByText('Heads up'));
        const body = form.querySelector('[data-form-stack]');
        expect(body).not.toContainElement(screen.getByText('Heads up'));
        expect(screen.getAllByText('Heads up')).toHaveLength(1);
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
