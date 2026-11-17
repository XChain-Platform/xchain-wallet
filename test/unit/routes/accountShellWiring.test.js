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
        // The signer list is read again between the two, so a hardware
        // wallet's record gains the identity of a network the account added.
        expect(source).toMatch(/onCreated=\{\(account\) => \{\s+if \(account\?\.id\) handleSwitchAccount\(account\.id\);\s+setSignerListKey\(\(n\) => n \+ 1\);\s+setUnlockedView\('home'\);/);
    });

    it('carries the account record into rename and returns canceled adds to the picker', () => {
        expect(source).toContain('setAccountRenameTarget(account);');
        expect(source).toContain('walletId={activeWalletId}');
        expect(source).toMatch(/<AddAccountForm[\s\S]*?onBack=\{goBack\}/);
    });

    it('opens the address list from the Settings My Addresses row and returns through the history', () => {
        expect(source).toMatch(/onOpenAddresses=\{\s*activeWalletId \? \(\) => \{\s*setSettingsInitialSection\('g-wallets'\);\s*setAddressDetailTarget\(null\);\s*setUnlockedView\('addresses'\);/);
        expect(source).toMatch(/<AddressList[\s\S]*?onBack=\{goBack\}[\s\S]*?selectedAddress=\{addressDetailTarget\}[\s\S]*?onDetailBack=\{goBack\}/);
    });

    it('returns a Settings-opened picker to Settings through the history', () => {
        expect(source).toMatch(/onOpenAccountPicker=\{\s*activeWalletId \? \(\) => \{\s*setSettingsInitialSection\('g-wallets'\);\s*setUnlockedView\('account-picker'\);/);
        expect(source).toMatch(/<AccountPicker[\s\S]*?onBack=\{goBack\}/);
        expect(source).not.toContain('accountPickerBackTo');
    });
});
