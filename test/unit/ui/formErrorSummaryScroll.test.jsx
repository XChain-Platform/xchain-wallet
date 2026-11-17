// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// G129 (operator 2026-11-16): a failed submit scrolls the page to the top so
// the error summary at the top of the form is the first thing seen.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { Button, FormPage, Input, useFormErrors } from '../../../packages/core/src/ui/index.js';

afterEach(cleanup);

function Form() {
    const errors = useFormErrors();
    return (
        <div data-testid="scroller" style={{ overflow: 'auto', height: 100 }}>
            <FormPage
                label="Test form"
                errors={errors}
                onSubmit={(event) => { event.preventDefault(); errors.validate({ 'field-a': 'Enter a name.' }); }}
                actions={<Button type="submit">Save Name</Button>}
            >
                <Input id="field-a" label="Name" value="" onChange={() => {}} />
            </FormPage>
        </div>
    );
}

describe('form error summary (G129)', () => {
    it('scrolls the holding box to the top and focuses the summary on a failed submit', () => {
        render(<Form />);
        const scroller = screen.getByTestId('scroller');
        scroller.scrollTop = 400;
        expect(scroller.scrollTop).toBe(400);

        fireEvent.click(screen.getByRole('button', { name: 'Save Name' }));

        const summary = screen.getByRole('alert', { name: /form errors/i });
        expect(summary).toHaveTextContent('Enter a name.');
        expect(scroller.scrollTop).toBe(0);
        expect(summary).toHaveFocus();
    });
});
