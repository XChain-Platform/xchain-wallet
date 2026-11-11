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
import { describe, expect, it } from 'vitest';
import { walletMenuReturnView } from '../../../packages/extension/src/popup/App.jsx';

const source = readFileSync(
    join(process.cwd(), 'packages/extension/src/popup/App.jsx'),
    'utf8',
);

describe('extension wallet menu routing', () => {
    it('mounts Alerts with wallet alerts and returns to the origin view', () => {
        expect(source).toMatch(/case 'alerts':\s*setAlertsReturnView\(unlockedView\);\s*break;/);
        expect(source).toMatch(
            /if \(unlockedView === 'alerts' && activeWalletId\)[\s\S]*?<AlertsRoute[\s\S]*?walletId=\{activeWalletId\}[\s\S]*?alerts=\{walletAlerts\}[\s\S]*?onBack=\{\(\) => setUnlockedView\(alertsReturnView\)\}/,
        );
        expect(source).not.toMatch(/case 'alerts':[\s\S]{0,160}setUnlockedView\('home'\)/);
    });

    it('uses Home as the return target for a destination and its drilldowns', () => {
        expect(walletMenuReturnView('dispensers-list', 'dispensers-list')).toBe('home');
        expect(walletMenuReturnView('dispenser-detail', 'dispensers-list')).toBe('home');
        expect(walletMenuReturnView('list-detail', 'lists')).toBe('home');
        expect(walletMenuReturnView('manage-token', 'contacts')).toBe('manage-token');
    });

    it('keeps Lists and Contacts return state separate from token forms', () => {
        const handler = source.slice(
            source.indexOf('const handleWalletMenuSelect'),
            source.indexOf('// Shared catalogue', source.indexOf('const handleWalletMenuSelect')),
        );
        expect(handler).toContain('setListsReturnView(walletMenuReturnView(unlockedView, viewId))');
        expect(handler).toContain('setContactsReturnView(walletMenuReturnView(unlockedView, viewId))');
        expect(handler).not.toContain('setFormReturnView');
        expect(source).toMatch(/<MyLists[\s\S]*?onBack=\{\(\) => \{\s*setUnlockedView\(listsReturnView\)/);
        expect(source).toMatch(/<ContactsList[\s\S]*?onBack=\{\(\) => \{\s*setUnlockedView\(contactsReturnView\)/);
    });

    it('leaves route state unchanged when the active destination is selected again', () => {
        expect(source).toMatch(
            /const handleWalletMenuSelect = \(viewId\) => \{\s*if \(viewId === unlockedView\) return;\s*switch \(viewId\)/,
        );
    });
});
