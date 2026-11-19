// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Each shell wires the hardware wallet pages the same way: one sign page,
// the reconnect pass at unlock, Connect Hardware Wallet from Welcome (first
// mode, then Set Password) and from Add Wallet (add mode), the two-phone
// pairing under Settings, Advanced, and Unlink back from Wallet Details.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Vitest runs from the package root, as the other source-reading tests assume.
const ROOT = '';
const SHELLS = [
    ['web', 'packages/web/src/App.jsx'],
    ['extension', 'packages/extension/src/popup/App.jsx'],
    ['desktop', 'packages/desktop/renderer/App.jsx'],
];

const count = (src, needle) => src.split(needle).length - 1;

describe.each(SHELLS)('%s shell hardware wallet wiring', (_name, rel) => {
    const src = readFileSync(`${ROOT}${rel}`, 'utf8');

    it('mounts the sign page exactly once', () => {
        expect(count(src, '<HardwareSignPage />')).toBe(1);
    });

    it('registers paired devices again once unlocked, with the shell factories', () => {
        expect(src).toMatch(/useHardwareReconnect\(\{[\s\S]*?unlocked: status\.state === 'unlocked'[\s\S]*?registerRecord: registerHardwareRecord[\s\S]*?factories: HARDWARE_PAIR_FACTORIES/);
    });

    it('runs Welcome connect as first mode with Set Password, and Add Wallet connect as add mode', () => {
        expect(count(src, '<HardwareFirstRun')).toBe(1);
        expect(src.match(/<PairSignerForm\s+mode="add"/g)?.length).toBe(2);
        expect(src).not.toMatch(/onPairPartner=/);
        expect(count(src, 'hardwareFactories={HARDWARE_PAIR_FACTORIES}')).toBe(2);
    });

    it('opens the two-phone pairing from Settings and returns from Unlink', () => {
        expect(src).toContain("onPairAnotherPhone={() => setUnlockedView('pair-partner')}");
        expect(src).toContain("unlockedView === 'pair-partner'");
        expect(src).toContain('onUnlinked={handleWalletUnlinked}');
    });

    // G131: a hardware wallet's accounts open in the shared My Accounts page,
    // made active first because that page lists the active wallet's accounts.
    it('opens the shared My Accounts page from a hardware wallet\'s Accounts row', () => {
        expect(src).toContain('onOpenAccounts={handleHardwareOpenAccounts}');
        expect(src).toMatch(/const handleHardwareOpenAccounts = \(wallet\) => \{[\s\S]*?handleSwitchWallet\(wallet\.id, wallet\.name\);[\s\S]*?setUnlockedView\('account-picker'\);/);
        expect(src).not.toMatch(/handleHardwareAddAccount/);
    });
});
