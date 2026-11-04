// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The wallet, account and all-settings rows in the header settings popover
// stay native buttons for full-row navigation, and each carries the shared
// Button base with one variant and one size, so they share the kit's border,
// radius, height, focus ring and hover with every other button.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { HeaderSettingsButton } from '../../../packages/core/src/shared/components/HeaderSettingsButton.jsx';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';
import { preloadOnDemandOverlays } from '../../../packages/core/src/shared/components/onDemandOverlays.js';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

beforeAll(() => preloadOnDemandOverlays());

beforeEach(() => {
    resetBackStackForTests();
});

vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({
    useReachability: () => ({ overall: 'normal', perChain: [] }),
}));

afterEach(() => {
    cleanup();
    resetBackStackForTests();
    vi.restoreAllMocks();
});

const headerSettingsCss = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/components/HeaderSettingsButton.module.css'),
    'utf8',
);

function summaryRowRule() {
    const match = /(?:^|\})\s*\.summaryRow\s*\{([^}]*)\}/m.exec(headerSettingsCss);
    return match ? match[1].replace(/\/\*[\s\S]*?\*\//g, '') : '';
}

describe('HeaderSettingsButton summary rows', () => {
    it('gives the wallet, account and all-settings rows the shared Button base', () => {
        const onOpenWalletPicker = vi.fn();
        render(
            <HeaderSettingsButton
                activeWallet={{ id: 'w1', name: 'Main' }}
                activeAccount={{ id: 'a1', name: 'Everyday', index: 0 }}
                onOpenWalletPicker={onOpenWalletPicker}
                onOpenAccountPicker={() => {}}
                onOpenSettings={() => {}}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

        const popover = screen.getByRole('dialog', { name: 'Wallet settings' });
        const rows = ['Main', 'Everyday', 'All settings'].map((name) => within(popover).getByRole('button', { name }));
        for (const row of rows) {
            expect(row.tagName).toBe('BUTTON');
            expect(row).toHaveClass(buttonStyles.btn, buttonStyles.secondary, buttonStyles.md);
        }

        fireEvent.click(rows[0]);
        expect(onOpenWalletPicker).toHaveBeenCalledTimes(1);
    });

    it('leaves the border, radius, height, padding and font size to the Button base', () => {
        const rule = summaryRowRule();
        expect(rule).not.toBe('');
        expect(rule).not.toMatch(/(?:^|[;\s])(?:border|border-radius|min-height|padding|font-size)\s*:/);
        expect(headerSettingsCss).not.toMatch(/composes\s*:/);
    });
});
