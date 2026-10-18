// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A help affordance for a section sits in that section's heading row. An
// InfoTip rendered as a loose sibling above the section would leave a lone
// "?" floating on its own line, as the oracle form's tip would.

import { readFileSync } from 'node:fs';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

import { FormSection } from '../../../packages/core/src/ui/FormSection.jsx';

afterEach(() => cleanup());

describe('FormSection trailing slot', () => {
    it('renders the trailing node in the same header row as the title', () => {
        render(<FormSection title="My published prices" trailing={<button type="button">More info</button>}>body</FormSection>);
        const header = screen.getByRole('heading', { name: 'My published prices' }).closest('[data-xc-section-header]');
        expect(within(header).getByRole('button', { name: 'More info' })).toBeTruthy();
    });
});

describe('OracleForm help affordance', () => {
    it('passes its InfoTip to the section heading instead of floating above it', () => {
        const source = readFileSync('packages/core/src/shared/routes/OracleForm.jsx', 'utf8');
        expect(source).toMatch(/title="My published prices"\s+trailing=\{<InfoTip/);
        expect(source.match(/<InfoTip/g)).toHaveLength(1);
    });
});
