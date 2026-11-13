// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The popup's wallet menu drives the one navigation history: a tab-bar root
// starts it over, any other row opens on top of the page the user was on,
// and every destination's Back pops to that page.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
    join(process.cwd(), 'packages/extension/src/popup/App.jsx'),
    'utf8',
);

const handler = source.slice(
    source.indexOf('const handleWalletMenuSelect'),
    source.indexOf('// Shared catalogue', source.indexOf('const handleWalletMenuSelect')),
);

describe('extension wallet menu routing', () => {
    it('mounts Alerts with wallet alerts and returns to the origin page through the history', () => {
        expect(source).toMatch(
            /if \(unlockedView === 'alerts' && activeWalletId\)[\s\S]*?<AlertsRoute[\s\S]*?walletId=\{activeWalletId\}[\s\S]*?alerts=\{walletAlerts\}[\s\S]*?onBack=\{goBack\}/,
        );
        expect(handler).not.toMatch(/case 'alerts'/);
    });

    it('resets the history for tab-bar roots and pushes every other menu row', () => {
        expect(handler).toContain('if (TAB_BAR_DESTINATIONS.includes(viewId)) resetNav(viewId);');
        expect(handler).toContain('else setUnlockedView(viewId);');
    });

    it('keeps no per-page return state for Lists, Contacts or forms', () => {
        expect(source).not.toMatch(/ReturnView|BackTo\b|ReturnTo\b/);
        expect(source).not.toContain('walletMenuReturnView');
        expect(source).toMatch(/<MyLists[\s\S]*?onBack=\{goBack\}/);
        expect(source).toMatch(/<ContactsList[\s\S]*?onBack=\{goBack\}/);
    });

    it('leaves route state unchanged when the active destination is selected again', () => {
        expect(source).toMatch(
            /const handleWalletMenuSelect = \(viewId\) => \{\s*if \(viewId === unlockedView\) return;\s*switch \(viewId\)/,
        );
    });
});
