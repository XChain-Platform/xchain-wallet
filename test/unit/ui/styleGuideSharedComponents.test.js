// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The style guide shows the shared components the screens use, not only the
// UI barrel: a component three or more routes import has a live example.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOCUMENTED_COMPONENTS } from '../../../packages/web/src/style-guide/StyleGuidePage.jsx';

const root = path.resolve(import.meta.dirname, '../../..');
const routesDir = path.join(root, 'packages/core/src/shared/routes');
const componentsDir = path.join(root, 'packages/core/src/shared/components');
const guideDir = path.join(root, 'packages/web/src/style-guide/sections');

// Routes that import a component by this many files count as using it widely.
const WIDE_USE = 3;

// Imported by routes but not a visual component, so it has no example.
const INTERNAL_ONLY = Object.freeze({
    LockedTokenContext: 'a React context module that carries the locked token; it renders nothing',
});

// The shell and screen parts the UI survey found missing; each keeps a live
// example whatever the route import count becomes.
const REQUIRED = Object.freeze([
    'ActionConfirmScreen', 'WatcherResultPanel', 'QueuedResultPanel', 'SignCredentials',
    'OwnAddressPickerScreen', 'NativeFeeToggle', 'OfflineEmptyState', 'ListPickerScreen',
    'ListToolbar', 'DraftDiscardButton', 'ContractConsentPanel', 'OwnerWithdrawWarning',
    'DemoExitConfirm', 'BalancesUncheckedState', 'HistoryEntryRow', 'ActivityRow',
    'HomeTabs', 'BottomTabBar', 'LeftNav', 'HeaderActionMenu',
]);

function routeImportCounts() {
    const counts = new Map();
    for (const file of fs.readdirSync(routesDir).filter((name) => name.endsWith('.jsx'))) {
        const source = fs.readFileSync(path.join(routesDir, file), 'utf8');
        const seen = new Set();
        for (const match of source.matchAll(/from '(?:\.\.\/components|@xchain-wallet\/core\/shared\/components)\/([A-Za-z]+)\.jsx'/g)) {
            seen.add(match[1]);
        }
        for (const name of seen) counts.set(name, (counts.get(name) || 0) + 1);
    }
    return counts;
}

describe('style guide shared component coverage', () => {
    it('shows every shared component that three or more routes import', () => {
        const documented = new Set(DOCUMENTED_COMPONENTS);
        const missing = [...routeImportCounts()]
            .filter(([name, count]) => count >= WIDE_USE
                && fs.existsSync(path.join(componentsDir, `${name}.jsx`))
                && !documented.has(name)
                && !(name in INTERNAL_ONLY))
            .map(([name, count]) => `${name} (${count} routes)`);
        expect(missing, 'add a style-guide section or an INTERNAL_ONLY reason').toEqual([]);
    });

    it('keeps an allowlist entry only while a route imports the component', () => {
        const counts = routeImportCounts();
        for (const [name, reason] of Object.entries(INTERNAL_ONLY)) {
            expect(reason.length, `${name} has a reason`).toBeGreaterThan(10);
            expect(counts.get(name) || 0, `${name} is still imported by routes`).toBeGreaterThan(0);
        }
    });

    it('documents the survey components and names only files that exist', () => {
        for (const name of REQUIRED) {
            expect(DOCUMENTED_COMPONENTS, `${name} has a live example`).toContain(name);
        }
        expect(new Set(DOCUMENTED_COMPONENTS).size).toBe(DOCUMENTED_COMPONENTS.length);
        for (const name of DOCUMENTED_COMPONENTS) {
            const exists = fs.existsSync(path.join(componentsDir, `${name}.jsx`))
                || fs.existsSync(path.join(routesDir, `${name}.jsx`));
            expect(exists, `${name} is a shared component file`).toBe(true);
        }
    });

    it('shows the Button link variant and the StatusMessage info state', () => {
        const buttons = fs.readFileSync(path.join(guideDir, 'ButtonsSection.jsx'), 'utf8');
        const states = fs.readFileSync(path.join(guideDir, 'StatesSection.jsx'), 'utf8');
        expect(buttons).toMatch(/const VARIANTS = \[[^\]]*'link'/);
        expect(states).toContain('<StatusMessage variant="info">');
    });

    it('draws the shared parts from the real components, not route CSS copies', () => {
        for (const file of [
            'PillSegmentedSection', 'ToggleBarSection', 'QuickActionSection',
            'StackedAssetIconSection', 'AssetHeroSection', 'AssetCardSection',
        ]) {
            const source = fs.readFileSync(path.join(guideDir, `${file}.jsx`), 'utf8');
            expect(source, `${file} has no own CSS module`).not.toMatch(new RegExp(`${file}\\.module\\.css`));
        }
    });
});
