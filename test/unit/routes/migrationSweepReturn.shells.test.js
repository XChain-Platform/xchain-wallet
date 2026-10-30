// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Back or Done from a migration sweep returns to the Migrate-to-BIP39 list in
// every shell, not to Home: Home has no way back to that list short of a new
// upgrade, which makes another phrase and another wallet and strands the
// remaining legacy addresses.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SHELLS = {
    web: 'packages/web/src/App.jsx',
    extension: 'packages/extension/src/popup/App.jsx',
    desktop: 'packages/desktop/renderer/App.jsx',
};

function block(source, start, end) {
    const from = source.indexOf(start);
    expect(from, `missing ${start}`).toBeGreaterThan(-1);
    const to = source.indexOf(end, from + start.length);
    expect(to, `missing ${end} after ${start}`).toBeGreaterThan(from);
    return source.slice(from, to);
}

describe.each(Object.entries(SHELLS))('%s shell returns from a migration sweep to the list', (_shell, rel) => {
    const source = readFileSync(join(root, rel), 'utf8');

    it('routes Back or Done of a migration sweep to the wizard, flagged to reopen its list', () => {
        const sweep = block(source, "if (unlockedView === 'sweep'", '/>');
        const onBack = block(sweep, 'onBack={() => {', 'initialChainId=');
        const migrateBranch = block(onBack, 'if (fromMigrate)', 'else formBack()');
        expect(migrateBranch).toContain('setMigrateResume(true)');
        expect(migrateBranch).toContain("setUnlockedView('migrate-bip39')");
        expect(migrateBranch).not.toContain("setUnlockedView('home')");
    });

    it('hands the flag to the wizard and drops it when the wizard closes', () => {
        const wizard = block(source, '<MigrateToBip39', 'onSweepChain=');
        expect(wizard).toContain('resumeList={migrateResume}');
        const onBack = block(wizard, 'onBack={() => {', 'onMigrated=');
        expect(onBack).toContain('setMigrateResume(false)');
    });
});
