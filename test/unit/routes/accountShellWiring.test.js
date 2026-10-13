// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const shells = [
    'packages/web/src/App.jsx',
    'packages/desktop/renderer/App.jsx',
    'packages/extension/src/popup/App.jsx',
];

describe.each(shells)('%s account routes', (file) => {
    const source = readFileSync(file, 'utf8');

    it('activates a newly created account and returns to Home', () => {
        expect(source).toMatch(/onCreated=\{\(account\) => \{\s+if \(account\?\.id\) handleSwitchAccount\(account\.id\);\s+setUnlockedView\('home'\);/);
    });

    it('carries the account record into rename and returns canceled adds to the picker', () => {
        expect(source).toContain('setAccountRenameTarget(account);');
        expect(source).toContain('walletId={activeWalletId}');
        expect(source).toContain('onBack={() => setUnlockedView(\'account-picker\')}');
    });

    it('returns a Settings-opened picker to Settings', () => {
        expect(source).toContain("setAccountPickerBackTo('settings');");
        expect(source).toContain('onBack={() => setUnlockedView(accountPickerBackTo)}');
    });
});
