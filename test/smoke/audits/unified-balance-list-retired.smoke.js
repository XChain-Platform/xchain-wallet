// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §27 / Cluster I FOLLOWUP 7 smoke: UnifiedBalanceList retired.
//
// Asserts the orphan is gone and stays gone:
//   1. The component file + CSS module no longer exist.
//   2. No source file (packages/**/*.{js,jsx}) imports or mounts
//      UnifiedBalanceList. A grep that comes back empty proves the
//      retirement was clean; nothing's silently broken by the deletion.
//   3. The two smokes that previously asserted UnifiedBalanceList
//      parity (empty-state-nudge, token-detail) are renumbered through
//      the deleted section, not silently still present.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

// --- 1. Files removed ------------------------------------------------------

const componentDir = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components');
assert.ok(!existsSync(join(componentDir, 'UnifiedBalanceList.jsx')),
    'UnifiedBalanceList.jsx removed');
assert.ok(!existsSync(join(componentDir, 'UnifiedBalanceList.module.css')),
    'UnifiedBalanceList.module.css removed');

// --- 2. Zero references across packages/** sources ------------------------

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.next', '.turbo']);
const offenders = [];
function walk(dir) {
    for (const entry of readdirSync(dir).sort()) {
        if (SKIP_DIRS.has(entry)) continue;
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
            walk(full);
        } else if (entry.endsWith('.js') || entry.endsWith('.jsx')) {
            const src = readFileSync(full, 'utf8');
            if (/\bUnifiedBalanceList\b/.test(src)) {
                offenders.push(full.slice(wsRoot.length + 1));
            }
        }
    }
}
walk(join(wsRoot, 'packages'));
assert.deepEqual(offenders, [],
    `no source file should reference UnifiedBalanceList; found: ${offenders.join(', ')}`);

// --- 3. Smokes that used to assert UnifiedBalanceList are renumbered ------

const emptyNudgeSrc = readFileSync(
    join(wsRoot, 'test', 'smoke', 'ui', 'empty-state-nudge.smoke.js'),
    'utf8',
);
assert.ok(!/UnifiedBalanceList/.test(emptyNudgeSrc.replace(/^[\s\S]*?(?=\/\/ ---)/, '').replace(/\/\/[^\n]*UnifiedBalanceList[^\n]*\n/g, '')),
    'empty-state-nudge.smoke.js no longer asserts UnifiedBalanceList parity (header comment about retirement is allowed)');
assert.ok(!/readFileSync\(join\(components, 'UnifiedBalanceList\.jsx'\)/.test(emptyNudgeSrc),
    'empty-state-nudge.smoke.js no longer reads UnifiedBalanceList.jsx');

const tokenDetailSrc = readFileSync(
    join(wsRoot, 'test', 'smoke', 'ui', 'token-detail.smoke.js'),
    'utf8',
);
assert.ok(!/readFileSync\(join\(components, 'UnifiedBalanceList\.(jsx|module\.css)'\)/.test(tokenDetailSrc),
    'token-detail.smoke.js no longer reads UnifiedBalanceList.jsx / .module.css');

console.log(
    'OK: unified-balance-list-retired smoke (§27 / Cluster I FOLLOWUP 7): UnifiedBalanceList.jsx + .module.css removed; zero references across packages/**; empty-state-nudge + token-detail smokes dropped their parity sections; orphan gone for good',
);
