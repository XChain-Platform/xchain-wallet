// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Source contract for the shared focus-visible ring and clipped list rows.

import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const ui = join(wsRoot, 'packages', 'core', 'src', 'ui');
const components = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components');
const routes = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes');
const styleGuide = join(wsRoot, 'packages', 'web', 'src', 'style-guide', 'sections');

const tokens = readFileSync(join(ui, 'tokens.css'), 'utf8');
const baseRule = /:where\(([\s\S]*?)\):focus-visible\s*\{([^}]*)\}/.exec(tokens);
assert.ok(baseRule, 'tokens.css: shared :focus-visible rule exists');
for (const selector of [
    'a[href]',
    'audio[controls]',
    'button',
    'input',
    'select',
    'textarea',
    "[role='button']",
    "[role='link']",
    "[role='menuitem']",
    "[role='option']",
    "[role='tab']",
    "[role='switch']",
    "[tabindex]:not([tabindex='-1'])",
    "[contenteditable]:not([contenteditable='false'])",
]) {
    assert.ok(baseRule[1].includes(selector), `tokens.css: base ring covers ${selector}`);
}
assert.match(
    baseRule[2],
    /outline:\s*2px solid var\(--xc-focus-ring\) !important/,
    'tokens.css: component resets cannot suppress the shared ring',
);
assert.match(
    baseRule[2],
    /outline-offset:\s*-2px !important/,
    'tokens.css: overflow-hidden parents cannot clip the shared ring',
);
assert.match(tokens, /:root\s*\{[\s\S]*?--xc-focus-ring:\s*#0F172A;/, 'light theme has a visible ring');
assert.equal((tokens.match(/--xc-focus-ring:\s*#FFFFFF;/g) || []).length, 2, 'dark theme paths have a visible ring');

const cssFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith('.css') ? [path] : [];
});

for (const path of cssFiles(join(wsRoot, 'packages'))) {
    assert.doesNotMatch(
        readFileSync(path, 'utf8'),
        /outline:\s*(?:none|0)\s*!important/,
        `${path}: an important outline reset would suppress the shared replacement ring`,
    );
}

/**
 * Each entry: relative CSS path + the button class that needs the
 * focus ring. The pattern matches `.<klass>:focus-visible { ...
 * outline: ... var(--xc-focus-ring) ...}`.
 */
const targets = [
    [join(components, 'AlertsOverlay.module.css'), 'close'],
    [join(components, 'BackupReminderCard.module.css'), 'dismissBtn'],
    [join(components, 'HwSignBlock.module.css'), 'refresh'],
    [join(components, 'QueuedBroadcastBanner.module.css'), 'broadcastBtn'],
    [join(components, 'QueuedBroadcastBanner.module.css'), 'discardBtn'],
    [join(components, 'RawPsbtViewer.module.css'), 'toggle'],
    [join(components, 'RawPsbtViewer.module.css'), 'copyBtn'],
    [join(components, 'ReachabilityBanner.module.css'), 'retry'],
    [join(ui, 'FeeSelector.module.css'), 'slider'],
];

for (const [path, klass] of targets) {
    const src = readFileSync(path, 'utf8');
    const re = new RegExp(`\\.${klass}\\b[\\s\\S]{0,80}?:focus-visible[\\s\\S]{0,200}?--xc-focus-ring`);
    assert.ok(re.test(src), `${path}: .${klass}:focus-visible references --xc-focus-ring`);
}

const clippedTargets = [
    [join(components, 'BalanceList.module.css'), 'rowClickable'],
    [join(components, 'ContactsPickerScreen.module.css'), 'abRow'],
    [join(routes, 'AddressList.module.css'), 'addrRow'],
    [join(routes, 'ContactsList.module.css'), 'row'],
    [join(routes, 'DispensersList.module.css'), 'row'],
    [join(routes, 'MyLists.module.css'), 'row'],
    [join(routes, 'MyTokens.module.css'), 'chip'],
    [join(routes, 'StakingList.module.css'), 'row'],
    [join(styleGuide, 'AddressListSection.module.css'), 'abRow'],
    [join(styleGuide, 'BalanceListSection.module.css'), 'row'],
];

for (const [path, klass] of clippedTargets) {
    const src = readFileSync(path, 'utf8');
    const re = new RegExp(`\\.${klass}:focus-visible\\s*\\{[^}]*outline-offset:\\s*-2px`, 's');
    assert.ok(re.test(src), `${path}: .${klass} draws its ring inside the clipped container`);
}

console.log('OK: shared focus-visible ring covers interactive controls and stays inside clipped lists/cards');
