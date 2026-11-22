// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BottomTabBar } from '../../../packages/core/src/shared/components/BottomTabBar.jsx';

const popupAppSource = readFileSync(
    join(process.cwd(), 'packages', 'extension', 'src', 'popup', 'App.jsx'),
    'utf8',
);
function NavigationHarness({ initialView = 'home' }) {
    const [view, setView] = useState(initialView);
    return (
        <>
            <output data-testid="current-view">{view}</output>
            <BottomTabBar
                currentView={view}
                onSelect={setView}
                onOpenSettings={() => setView('settings')}
            />
        </>
    );
}

afterEach(() => cleanup());

describe('extension bottom navigation', () => {
    it('mounts the shared bottom bar in the extension compact layout', () => {
        expect(popupAppSource).toMatch(
            /import \{ BottomTabBar \} from '@xchain-wallet\/core\/shared\/components\/BottomTabBar\.jsx'/,
        );
        expect(popupAppSource).toMatch(
            /<FullLayoutWithNav[\s\S]*?bottomBar=\{\([\s\S]*?<BottomTabBar/,
        );
        expect(popupAppSource).toMatch(/currentView=\{unlockedView\}/);
        expect(popupAppSource).toMatch(/onSelect=\{handleWalletMenuSelect\}/);
    });

    // A full-screen tab is the same popup.html at window width, so the shell
    // hands FullLayoutWithNav the side menu too; the layout measures itself
    // and mounts the menu from 640px and the tab bar below it.
    it('hands the extension layout the same side menu the web wallet shows', () => {
        expect(popupAppSource).toMatch(
            /import \{ FullLayoutWithNav, LeftNav \} from '@xchain-wallet\/core\/shared\/components\/LeftNav\.jsx'/,
        );
        const nav = /<FullLayoutWithNav[\s\S]*?nav=\{\(\s*<LeftNav([\s\S]*?)\/>\s*\)\}/.exec(popupAppSource);
        expect(nav, 'FullLayoutWithNav gets no LeftNav').not.toBeNull();
        const props = nav[1];
        expect(props).toMatch(/currentView=\{unlockedView\}/);
        expect(props).toMatch(/onSelect=\{handleWalletMenuSelect\}/);
        expect(props).toMatch(/onLock=\{handleLock\}/);
        expect(props).toMatch(/onOpenSettings=\{openSettingsRoot\}/);
        for (const gate of ['hasVmAddress', 'hasBtcAddress', 'hasGovernanceAddress', 'isSignerMode']) {
            expect(props).toMatch(new RegExp(`${gate}=\\{${gate}\\}`));
        }
        expect(props).toMatch(/\bhasDexSurface\b/);
        // The menu's Settings row and the Settings tab open Settings the same way.
        expect(popupAppSource).toMatch(/<BottomTabBar[\s\S]*?onOpenSettings=\{openSettingsRoot\}/);
    });

    it('gives wide Home and My Tokens their detail panels in a full-screen tab', () => {
        expect(popupAppSource).toMatch(/renderDetail=\{activeWalletId \? renderHomeDetail : undefined\}/);
        expect(popupAppSource).toMatch(/detailSelection=\{homeDetail\?\.walletId === activeWalletId \? homeDetail\.item : null\}/);
        expect(popupAppSource).toMatch(/onDetailSelect=\{selectHomeDetail\}/);
        expect(popupAppSource).toMatch(/renderToken=\{\(row\) => renderTokenDetail\(/);
        // An embedded panel's actions first make its asset the shell's token.
        expect(popupAppSource).toMatch(/const renderTokenDetail = \(assetRef, \{ embedded = false, ownerView = false \} = \{\}\)/);
        expect(popupAppSource).toMatch(/onIssuerResolved=\{embedded \? undefined :/);
    });

    it.each([
        ['Home', 'home'],
        ['Send', 'send'],
        ['Receive', 'receive'],
        ['History', 'history'],
        ['Settings', 'settings'],
    ])('routes the %s tab to %s', (label, expectedView) => {
        render(<NavigationHarness />);
        fireEvent.click(screen.getByRole('button', { name: label }));
        expect(screen.getByTestId('current-view')).toHaveTextContent(expectedView);
    });

    it('follows the current view across all five tabs', () => {
        render(<NavigationHarness initialView="history" />);
        expect(screen.getByRole('button', { name: 'History' })).toHaveAttribute('aria-current', 'page');

        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('aria-current', 'page');

        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
        expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    });

    it.each(['contacts', 'account-picker'])(
        'leaves the bar tabs unmarked for the %s destination',
        (initialView) => {
            render(<NavigationHarness initialView={initialView} />);
            expect(screen.getByRole('button', { name: 'Home' }))
                .not.toHaveAttribute('aria-current');
        },
    );
});
