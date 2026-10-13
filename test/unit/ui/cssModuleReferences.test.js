// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { expect, it } from 'vitest';

import { parseRules } from '../../../packages/core/scripts/forced-colors-audit.js';

const DYNAMIC_CLASS_PREFIXES = new Map([
    ['shared/components/PreflightPanel.module.css', ['chip_']],
    ['shared/components/ToastHost.module.css', ['variant_']],
    ['shared/routes/DispensersList.module.css', ['status_']],
    ['shared/routes/StakingList.module.css', ['status_']],
]);

function findCoreSource() {
    let dir = process.cwd();
    while (!existsSync(join(dir, 'packages', 'core', 'src'))) {
        const up = dirname(dir);
        if (up === dir) throw new Error('packages/core/src not found above the cwd');
        dir = up;
    }
    return join(dir, 'packages', 'core', 'src');
}

function filesBelow(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        return entry.isDirectory() ? filesBelow(path) : [path];
    });
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

it('has no literal CSS module class without a source reference', () => {
    const sourceRoot = findCoreSource();
    const files = filesBelow(sourceRoot);
    const source = files
        .filter((file) => /\.(?:js|jsx|ts|tsx)$/.test(file))
        .map((file) => readFileSync(file, 'utf8'))
        .join('\n');
    const orphaned = [];

    for (const file of files.filter((path) => path.endsWith('.module.css'))) {
        const modulePath = relative(sourceRoot, file);
        const dynamicPrefixes = DYNAMIC_CLASS_PREFIXES.get(modulePath) || [];
        const classNames = new Set();

        for (const rule of parseRules(readFileSync(file, 'utf8'))) {
            for (const match of rule.selector.matchAll(/\.([_a-zA-Z][_a-zA-Z0-9-]*)/g)) {
                classNames.add(match[1]);
            }
        }

        for (const className of classNames) {
            // Variant and status classes are selected through computed module keys.
            if (dynamicPrefixes.some((prefix) => className.startsWith(prefix))) continue;
            const escaped = escapeRegExp(className);
            if (!new RegExp(`(?:\\.|["'\`])${escaped}(?:\\b|["'\`])`).test(source)) {
                orphaned.push(`${modulePath}: .${className}`);
            }
        }
    }

    expect(orphaned).toEqual([]);
});
