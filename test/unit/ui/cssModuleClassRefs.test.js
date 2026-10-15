// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// A class read off a CSS module that the module never defines is `undefined`,
// so the element renders unstyled and nothing fails. The My dispensers toolbar
// stacked its search and network fields with no gap for that reason. The
// references below predate this guard; the list may only shrink.
const KNOWN_UNDEFINED = [
    'packages/core/src/shared/routes/BetFeedsList.jsx local.marketItem',
    'packages/core/src/shared/routes/DispenserDetail.jsx styles.entryDescription',
    'packages/core/src/shared/routes/Home.jsx styles.bodyFull',
    'packages/core/src/shared/routes/MultisigSigningSession.jsx styles.list',
    'packages/core/src/shared/routes/MultisigSigningSession.jsx styles.row',
    'packages/core/src/shared/routes/MultisigSigningSession.jsx styles.rowMeta',
    'packages/core/src/shared/routes/MultisigSigningSession.jsx styles.rowSubtle',
    'packages/core/src/shared/routes/MultisigSigningSession.jsx styles.rowTitle',
    'packages/core/src/shared/routes/ParallelComposer.jsx parallelStyles.rowEditor',
    'packages/core/src/shared/routes/Send.jsx styles.balanceHint',
    'packages/core/src/ui/ChainBadge.jsx styles.name',
    'packages/core/src/ui/FormSection.jsx styles.sectionHeader',
];

const root = process.cwd();

function sources(dir, found = []) {
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist' || name === 'www' || name.startsWith('.')) continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) sources(path, found);
        else if (/\.jsx$/.test(name)) found.push(path);
    }
    return found;
}

function undefinedReferences(base) {
    const found = [];
    for (const file of sources(join(root, 'packages', base))) {
        const text = readFileSync(file, 'utf8');
        for (const [, binding, rel] of text.matchAll(/import\s+(\w+)\s+from\s+['"]([^'"]+\.module\.css)['"]/g)) {
            let css;
            try { css = readFileSync(resolve(dirname(file), rel), 'utf8'); } catch { continue; }
            const defined = new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((match) => match[1]));
            const used = new Set([...text.matchAll(new RegExp(`\\b${binding}\\.([A-Za-z_]\\w*)`, 'g'))].map((match) => match[1]));
            for (const name of used) {
                if (!defined.has(name)) found.push(`${file.slice(root.length + 1)} ${binding}.${name}`);
            }
        }
    }
    return found;
}

describe('CSS module class references', () => {
    it('reads no class the module does not define, beyond the shrinking known list', () => {
        const found = undefinedReferences('core').sort();
        expect(found).toEqual([...KNOWN_UNDEFINED].sort());
    });
});
