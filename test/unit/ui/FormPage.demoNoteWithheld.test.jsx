// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A page that leads with the demo note itself hands its form a guard without
// the note. The form stays blocked, but it draws no notice wrapper of its own:
// an empty wrapper still takes a gap in the page stack.

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { FormPage } from '../../../packages/core/src/ui/FormPage.jsx';

afterEach(cleanup);

describe('FormPage demo guard', () => {
    it('draws the guard note when it has one', () => {
        const { container } = render(
            <FormPage label="Form" demoGuard={{ blocked: true, note: <p>Demo note</p>, dialog: null }}>
                <input aria-label="Field" />
            </FormPage>,
        );
        expect(container.textContent).toContain('Demo note');
    });

    it('draws no notice wrapper when the page withholds the note', () => {
        const { container } = render(
            <FormPage label="Form" demoGuard={{ blocked: true, note: null, dialog: null }}>
                <input aria-label="Field" />
            </FormPage>,
        );
        expect(container.querySelector('[class*="status"]')).toBeNull();
        expect(container.querySelector('form')).toBeTruthy();
    });
});
