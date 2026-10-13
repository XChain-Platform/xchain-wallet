// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { expect, it } from 'vitest';

import { parseRules } from '../../../packages/core/scripts/forced-colors-audit.js';
import { cachedSourceFiles } from '../../helpers/sourceScan.js';

const CLASS_NAME_PATTERN = /\.([_a-zA-Z][_a-zA-Z0-9-]*)/g;
const CLASS_REFERENCE_PATTERN = /(?:\.|["'`])([_a-zA-Z][_a-zA-Z0-9-]*)/g;
const QUOTE_PATTERN = /["'`]/;
const WORD_PATTERN = /\w/;

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

function referencedClassNames(source, classNames) {
    const referenced = new Set();
    for (const match of source.matchAll(CLASS_REFERENCE_PATTERN)) {
        const candidate = match[1];
        const valueStart = match.index + 1;
        for (let length = 1; length <= candidate.length; length += 1) {
            const className = candidate.slice(0, length);
            if (!classNames.has(className)) continue;
            const last = candidate[length - 1];
            const next = source[valueStart + length] || '';
            if (QUOTE_PATTERN.test(next) || WORD_PATTERN.test(last) !== WORD_PATTERN.test(next)) {
                referenced.add(className);
            }
        }
    }
    return referenced;
}

it('has no literal CSS module class without a source reference', () => {
    const sourceRoot = findCoreSource();
    const files = cachedSourceFiles(sourceRoot, '**/*.{js,jsx,ts,tsx,module.css}');
    const source = files
        .filter((file) => !file.relativePath.endsWith('.module.css'))
        .map((file) => file.source)
        .join('\n');
    const orphaned = [];
    const modules = [];
    const allClassNames = new Set();

    for (const file of files.filter(({ relativePath }) => relativePath.endsWith('.module.css'))) {
        const classNames = new Set();

        for (const rule of parseRules(file.source)) {
            for (const match of rule.selector.matchAll(CLASS_NAME_PATTERN)) {
                classNames.add(match[1]);
                allClassNames.add(match[1]);
            }
        }
        modules.push({ modulePath: file.relativePath, classNames });
    }

    const referenced = referencedClassNames(source, allClassNames);
    for (const { modulePath, classNames } of modules) {
        const dynamicPrefixes = DYNAMIC_CLASS_PREFIXES.get(modulePath) || [];

        for (const className of classNames) {
            // Variant and status classes are selected through computed module keys.
            if (dynamicPrefixes.some((prefix) => className.startsWith(prefix))) continue;
            if (!referenced.has(className)) {
                orphaned.push(`${modulePath}: .${className}`);
            }
        }
    }

    expect(orphaned).toEqual([]);
});
