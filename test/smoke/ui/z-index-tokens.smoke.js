// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const sourceRoot = join(root, 'packages', 'core', 'src');

const expectedLocalDeclarations = new Map(Object.entries({
    'shared/components/AppHeader.module.css': ['20'],
    'shared/components/LeftNav.module.css': ['1000'],
    'shared/components/PlatformSwitcher.module.css': ['20'],
    'shared/components/TxStatusTimeline.module.css': ['1'],
    'shared/routes/AddressList.module.css': ['200'],
    'shared/routes/ContactsList.module.css': ['100', '1000'],
    'shared/routes/DispenserDetail.module.css': ['20'],
    'shared/routes/History.module.css': ['20', '20', '1'],
    'shared/routes/Home.module.css': ['20'],
    'shared/routes/ManageToken.module.css': ['20'],
    'shared/routes/StakeDetail.module.css': ['20'],
    'shared/routes/TokenDetail.module.css': ['20'],
    'shared/routes/WalletPicker.module.css': ['1'],
}));

const cssFiles = [];
const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (entry.name.endsWith('.module.css')) cssFiles.push(path);
    }
};
visit(sourceRoot);

for (const file of cssFiles) {
    const name = relative(sourceRoot, file);
    const css = readFileSync(file, 'utf8');
    const raw = [...css.matchAll(/z-index:\s*(-?\d+)\s*;/g)].map((match) => match[1]);
    assert.deepEqual(
        raw,
        expectedLocalDeclarations.get(name) ?? [],
        `${name} has no new raw z-index declarations`,
    );
    expectedLocalDeclarations.delete(name);
}

assert.deepEqual(
    [...expectedLocalDeclarations.keys()],
    [],
    'every audited local z-index declaration still exists',
);
console.log(`OK: z-index token smoke (${cssFiles.length} CSS modules audited)`);
