// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The summary names a field once. A message that already names the field is
// shown without the label in front of it.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { FormErrorSummary } from '../../../packages/core/src/ui/FormErrorSummary.jsx';

afterEach(cleanup);

function link(error) {
    render(<FormErrorSummary errors={[{ id: 'f', ...error }]} focusKey={1} />);
    return screen.getByRole('link').textContent;
}

describe('FormErrorSummary label repetition', () => {
    it('drops a label whose words the message already uses', () => {
        expect(link({
            label: 'Transfer ownership to',
            message: 'Transfer ownership address is not valid for the active network.',
        })).toBe('Transfer ownership address is not valid for the active network.');
    });

    it('drops a label the message names in a longer form', () => {
        expect(link({
            label: 'Send the initial mint to',
            message: 'Sending the initial mint somewhere needs an initial mint above 0.',
        })).toBe('Sending the initial mint somewhere needs an initial mint above 0.');
    });

    it('drops a label the message names after other words', () => {
        expect(link({
            label: 'Give amount',
            message: 'Per-fill give amount must be a positive number.',
        })).toBe('Per-fill give amount must be a positive number.');
    });

    it('keeps a label the message does not name', () => {
        expect(link({
            label: 'Payment amount',
            message: 'Enter a positive token amount buyers pay per fill.',
        })).toBe('Payment amount: Enter a positive token amount buyers pay per fill.');
    });

    it('keeps a numbered label apart from a longer number', () => {
        expect(link({ label: 'Word 5', message: 'Word 50 does not match.' }))
            .toBe('Word 5: Word 50 does not match.');
    });
});
