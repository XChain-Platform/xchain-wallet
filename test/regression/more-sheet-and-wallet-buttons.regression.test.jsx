// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Regression suite: compact navigation and wallet controls.
//
//   [P1] 2026-10-13: A single More header row lets the close action cover
//        its title, while wallet footer actions shrink to the 24px tap floor.

import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { BottomTabBar } from '../../packages/core/src/shared/components/BottomTabBar.jsx';
import bottomBarStyles from '../../packages/core/src/shared/components/BottomTabBar.module.css';
import { WalletPicker } from '../../packages/core/src/shared/routes/WalletPicker.jsx';
import walletPickerStyles from '../../packages/core/src/shared/routes/WalletPicker.module.css';

const read = (relativePath) => readFileSync(join(process.cwd(), relativePath), 'utf8');
const bottomBarCss = read('packages/core/src/shared/components/BottomTabBar.module.css');
const walletPickerCss = read('packages/core/src/shared/routes/WalletPicker.module.css');

function rule(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
    expect(match, `${selector} rule`).not.toBeNull();
    return match[1];
}

afterEach(() => cleanup());

describe('regression/More sheet and wallet button sizing', () => {
    it('[REGRESSION P1] places a centred drag handle above a collision-free title row', () => {
        render(<BottomTabBar currentView="home" onSelect={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: 'More' }));

        const dialog = screen.getByRole('dialog', { name: 'More' });
        const header = dialog.querySelector(`.${bottomBarStyles.sheetHeader}`);
        const handle = dialog.querySelector(`.${bottomBarStyles.handle}`);
        const titleRow = dialog.querySelector(`.${bottomBarStyles.sheetTitleRow}`);
        const title = screen.getByRole('heading', { name: 'More', level: 2 });
        const close = screen.getByRole('button', { name: 'Close more navigation' });

        expect(header).not.toBeNull();
        expect(handle?.parentElement).toBe(header);
        expect(titleRow?.parentElement).toBe(header);
        expect(handle.compareDocumentPosition(titleRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(titleRow).toContainElement(title);
        expect(titleRow).toContainElement(close);

        expect(rule(bottomBarCss, '.sheetHeader')).toMatch(/flex-direction:\s*column/);
        expect(rule(bottomBarCss, '.sheetHeader')).toMatch(/align-items:\s*center/);
        expect(rule(bottomBarCss, '.sheetTitleRow')).toMatch(
            /grid-template-columns:\s*var\(--xc-control-h-md,\s*40px\)\s+1fr\s+var\(--xc-control-h-md,\s*40px\)/,
        );
        expect(rule(bottomBarCss, '.sheetTitleRow')).toMatch(/width:\s*100%/);
        expect(rule(bottomBarCss, '.sheetTitle')).toMatch(/grid-column:\s*2/);
        expect(rule(bottomBarCss, '.sheetTitle')).toMatch(/text-align:\s*center/);
        expect(rule(bottomBarCss, '.sheetClose')).toMatch(/grid-column:\s*3/);
        expect(rule(bottomBarCss, '.sheetClose')).not.toMatch(/position:\s*absolute/);
    });

    it('[REGRESSION P1] keeps Add wallet and Manage wallet at the medium control height', async () => {
        const wallet = { id: 'wallet-1', name: 'Primary', format: 'bip39' };
        render(
            <MessagingProvider
                shell="popup"
                messaging={{ listWallets: () => Promise.resolve([wallet]) }}
            >
                <WalletPicker
                    activeWalletId={wallet.id}
                    onSwitch={() => {}}
                    onAddWallet={() => {}}
                    onShowDetails={() => {}}
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );

        const add = await screen.findByRole('button', { name: 'Add wallet' });
        const manage = screen.getByRole('button', { name: 'Manage wallet' });
        expect(add.parentElement).toHaveClass(walletPickerStyles.footerActions);
        expect(manage.parentElement).toBe(add.parentElement);

        const footerButtonRule = rule(walletPickerCss, '.footerActions button');
        expect(footerButtonRule).toMatch(/min-height:\s*var\(--xc-control-h-md,\s*40px\)/);
        expect(footerButtonRule).not.toMatch(/--xc-tap-min/);
    });
});
