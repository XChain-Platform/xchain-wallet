// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// A11y runtime: Button primitive renders with no axe-core
// violations across every variant.

import { describe, it, expect } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { Button } from '../../../packages/core/src/ui/Button.jsx';

async function noViolations(html) {
    const result = await axe.run(html, {
        rules: { 'color-contrast': { enabled: false } }, // jsdom can't compute
    });
    return result.violations;
}

for (const variant of ['primary', 'secondary', 'ghost', 'danger']) {
    describe(`a11y/ui/button/${variant}`, () => {
        it('clean axe scan with a text label', async () => {
            const { container } = render(<Button variant={variant}>Send</Button>);
            const v = await noViolations(container);
            expect(v).toEqual([]);
            cleanup();
        });

        it('clean axe scan with an aria-label only', async () => {
            const { container } = render(<Button variant={variant} aria-label="Send">{''}</Button>);
            const v = await noViolations(container);
            expect(v).toEqual([]);
            cleanup();
        });
    });
}
