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
import overlayStyles from '../../packages/core/src/shared/components/OverlaySurface.module.css';
import { WalletPicker } from '../../packages/core/src/shared/routes/WalletPicker.jsx';
import walletPickerStyles from '../../packages/core/src/shared/routes/WalletPicker.module.css';

const read = (relativePath) => readFileSync(join(process.cwd(), relativePath), 'utf8');
const overlayCss = read('packages/core/src/shared/components/OverlaySurface.module.css');
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

        // The More sheet is the shared OverlaySurface sheet: the handle sits in
        // the header's top strip and the title row below it is a three-column
        // grid with the close control in its own cell.
        const dialog = screen.getByRole('dialog', { name: 'More' });
        const header = dialog.querySelector(`.${overlayStyles.header}`);
        const handle = dialog.querySelector(`.${overlayStyles.handle}`);
        const title = screen.getByRole('heading', { name: 'More', level: 2 });
        const close = screen.getByRole('button', { name: 'Close more navigation' });

        expect(header).not.toBeNull();
        expect(handle?.parentElement).toBe(header);
        expect(handle.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(header).toContainElement(title);
        expect(header).toContainElement(close);

        expect(rule(overlayCss, '.handle')).toMatch(/position:\s*absolute/);
        expect(rule(overlayCss, '.handle')).toMatch(/inset-inline:\s*0/);
        expect(rule(overlayCss, '.handle')).toMatch(/margin-inline:\s*auto/);
        expect(rule(overlayCss, '.sheet .header')).toMatch(/padding-top:\s*calc\(var\(--xc-space-1\) \+ var\(--xc-space-2\)\)/);
        expect(rule(overlayCss, '.header')).toMatch(
            /grid-template-columns:\s*var\(--xc-control-h-md\)\s+minmax\(0,\s*1fr\)\s+var\(--xc-control-h-md\)/,
        );
        expect(rule(overlayCss, '.title')).toMatch(/grid-column:\s*2/);
        expect(rule(overlayCss, '.sheet .title')).toMatch(/text-align:\s*center/);
        expect(rule(overlayCss, '.close')).toMatch(/grid-column:\s*3/);
        expect(rule(overlayCss, '.close')).not.toMatch(/position:\s*absolute/);
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
