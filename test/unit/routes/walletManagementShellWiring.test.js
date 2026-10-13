// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const SHELLS = [
    ['web', join(root, 'packages/web/src/App.jsx')],
    ['desktop', join(root, 'packages/desktop/renderer/App.jsx')],
    ['extension', join(root, 'packages/extension/src/popup/App.jsx')],
];

describe.each(SHELLS)('%s wallet management routing', (_name, path) => {
    const source = readFileSync(path, 'utf8');

    it('returns the picker to Settings when Settings opened it', () => {
        expect(source).toContain("onOpenWalletPicker={() => openWalletPicker('settings')}");
        expect(source).toContain('onBack={() => setUnlockedView(walletPickerReturnView)}');
        expect(source).toContain("setSettingsInitialSection('this-wallet')");
    });

    it('prefills rename and returns to the wallet details screen', () => {
        expect(source).toMatch(/onRename=\{\(wallet\) => \{[\s\S]*?name: wallet\.name/);
        expect(source).toMatch(/<RenameWalletForm[\s\S]*?initialName=\{walletRenameTarget\.name\}/);
        expect(source.match(/setUnlockedView\('wallet-details'\)/g)?.length).toBeGreaterThanOrEqual(3);
    });

    it('refreshes shell state after a demo wallet exits from details', () => {
        expect(source).toContain('onExited={refresh}');
    });
});
