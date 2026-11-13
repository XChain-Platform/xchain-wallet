// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Guards for the fixes the axe sweep (test/e2e/layout/axe-sweep.spec.js) drove:
// one banner per document, readable ticker chips.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AppHeader } from '../../../packages/core/src/shared/components/AppHeader.jsx';
import { tickerColor } from '../../../packages/core/src/shared/components/BalanceList.jsx';

afterEach(() => cleanup());

const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

describe('axe sweep fixes', () => {
    it('AppHeader is a labelled region, not a second banner', () => {
        render(<AppHeader onMenuOpen={() => {}} onLock={() => {}} />);
        expect(screen.queryByRole('banner')).toBeNull();
        expect(screen.getByRole('region', { name: 'App header' })).not.toBeNull();
    });

    it('every ticker chip color holds 4.5:1 against white text', () => {
        const seen = new Set();
        for (let i = 0; i < 400; i += 1) seen.add(tickerColor(`T${i}X${i * 7}`));
        expect(seen.size).toBe(15);
        for (const hex of seen) {
            expect(1.05 / (luminance(hex) + 0.05), hex).toBeGreaterThanOrEqual(4.5);
        }
    });
});
