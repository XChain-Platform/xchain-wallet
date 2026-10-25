// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: the form error summary marks the fields it names.
//
//   [P2] 2026-10-24: the summary linked to a failing field, but the field
//        itself carried no aria-invalid and no description, so a screen
//        reader on the field heard nothing about the error.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { FormErrorSummary } from '../../packages/core/src/ui/FormErrorSummary.jsx';

afterEach(cleanup);

function Form({ errors, focusKey = 1 }) {
    return (
        <form>
            <FormErrorSummary errors={errors} focusKey={focusKey} />
            <input id="a" aria-label="Alpha" aria-describedby="hint" />
            <p id="hint">A hint</p>
            <input id="b" aria-label="Beta" aria-invalid="true" />
            <input id="c" aria-label="Gamma" />
        </form>
    );
}

describe('regression/form-error-summary-marks-fields', () => {
    it('[REGRESSION P2] a named field is invalid and described by the summary', () => {
        render(<Form errors={[{ id: 'a', label: 'Alpha', message: 'Enter a value.' }]} />);
        const summary = screen.getByRole('alert');
        const field = screen.getByLabelText('Alpha');
        expect(field.getAttribute('aria-invalid')).toBe('true');
        expect(field.getAttribute('aria-describedby').split(' ')).toEqual(['hint', summary.id]);
        expect(screen.getByLabelText('Gamma').hasAttribute('aria-invalid')).toBe(false);
    });

    it('[REGRESSION P2] clearing the errors restores the field and keeps its own attributes', () => {
        const { rerender } = render(<Form errors={[
            { id: 'a', message: 'Enter a value.' },
            { id: 'b', message: 'Enter a value.' },
        ]} />);
        rerender(<Form errors={[]} />);
        const alpha = screen.getByLabelText('Alpha');
        expect(alpha.hasAttribute('aria-invalid')).toBe(false);
        expect(alpha.getAttribute('aria-describedby')).toBe('hint');
        // The field that was already invalid before the summary stays so.
        expect(screen.getByLabelText('Beta').getAttribute('aria-invalid')).toBe('true');
    });
});
