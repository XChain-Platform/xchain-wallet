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
    'shared/components/LeftNav.module.css': ['1000'],
    // The range label and foot sit in local chart stacking contexts.
    'shared/components/PortfolioChart.module.css': ['-1', '2'],
    // Scale labels sit over the SVG plot inside the Sparkline's own root.
    'shared/components/Sparkline.module.css': ['1'],
    // The filter badge sits above its button's corner inside the button's own box.
    'shared/components/HomeListFilterMenu.module.css': ['1'],
    // The flip button straddles the gap between the Give and Get cards.
    'shared/components/giveGet/GiveGet.module.css': ['1'],
    // The hero's first card layers above its overlapped grid sibling in a local stack.
    'shared/components/HomeTabs.module.css': ['2'],
    'shared/components/outcomeDetail/OutcomeDetail.module.css': ['1'],
    'shared/components/TxStatusTimeline.module.css': ['1'],
    'shared/routes/AddressList.module.css': ['200'],
    'shared/routes/ContactsList.module.css': ['100'],
    // The History card's More menu (the second 20) went with its ActionList (G101).
    'shared/routes/History.module.css': ['20'],
    // The kit Checkbox stacks its transparent native input over the painted box.
    'ui/Checkbox.module.css': ['1'],
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
