// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { existsSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';

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
    ['ui/Button.module.css', ['spinner_']],
    ['shared/components/OverlaySurface.module.css', ['dialogOverlay', 'sheetOverlay']],
]);

const DYNAMIC_CLASS_NAMES = new Map([
    ['shared/components/NetworkFilter.module.css', ['sm', 'md', 'lg']],
    ['shared/components/NetworkFilterDropdown.module.css', ['sm', 'md', 'lg']],
    ['shared/components/TokenField.module.css', ['lg']],
    // OverlaySurface selects its surface rule by variant name (styles[variant]).
    ['shared/components/OverlaySurface.module.css', ['dialog', 'sheet', 'popover']],
]);

// NoticeModal renders through OverlaySurface since the kit adoption, so its
// module has no importer. It stays until the layout tests that still read it
// move to OverlaySurface; nothing new may join this list.
const RETIRED_MODULES = new Set(['shared/components/NoticeModal.module.css']);

const M_TO_Z_MODULE_PATTERN = /^shared\/(?:components|routes)\/[M-Z][^/]*\.module\.css$/;
const CSS_MODULE_IMPORT_PATTERN = /import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+\.module\.css)['"]/g;

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

function escapePattern(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function moduleImporters(files) {
    const importers = new Map();
    for (const file of files.filter(({ relativePath }) => !relativePath.endsWith('.module.css'))) {
        for (const match of file.source.matchAll(CSS_MODULE_IMPORT_PATTERN)) {
            const modulePath = posix.normalize(posix.join(posix.dirname(file.relativePath), match[2]));
            const entries = importers.get(modulePath) || [];
            entries.push({ alias: match[1], source: file.source });
            importers.set(modulePath, entries);
        }
    }
    return importers;
}

function hasModuleReference(importers, className) {
    const escapedClassName = escapePattern(className);
    return importers.some(({ alias, source }) => {
        const escapedAlias = escapePattern(alias);
        const dotAccess = new RegExp(`\\b${escapedAlias}\\s*\\.\\s*${escapedClassName}\\b`);
        const bracketAccess = new RegExp(`\\b${escapedAlias}\\s*\\[\\s*['"\`]${escapedClassName}['"\`]\\s*\\]`);
        return dotAccess.test(source) || bracketAccess.test(source);
    });
}

it('has no literal CSS module class without a source reference', () => {
    const sourceRoot = findCoreSource();
    const files = cachedSourceFiles(sourceRoot, '**/*.{js,jsx,ts,tsx,module.css}');
    const source = files
        .filter((file) => !file.relativePath.endsWith('.module.css'))
        .map((file) => file.source)
        // A class another rule composes is referenced through CSS, not JS.
        .concat(files
            .filter((file) => file.relativePath.endsWith('.module.css'))
            .flatMap((file) => [...file.source.matchAll(/composes:\s*([^;]+?)(?:\s+from\s+[^;]+)?;/g)]
                .map((match) => match[1].trim().split(/\s+/).map((name) => `.${name}`).join(' '))))
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

it('has no unreferenced class in M-Z route and component modules', () => {
    const sourceRoot = findCoreSource();
    const files = cachedSourceFiles(sourceRoot, '**/*.{js,jsx,ts,tsx,module.css}');
    const importers = moduleImporters(files);
    const orphaned = [];

    for (const file of files.filter(({ relativePath }) => M_TO_Z_MODULE_PATTERN.test(relativePath)
        && !RETIRED_MODULES.has(relativePath))) {
        const dynamicNames = DYNAMIC_CLASS_NAMES.get(file.relativePath) || [];
        const dynamicPrefixes = DYNAMIC_CLASS_PREFIXES.get(file.relativePath) || [];

        for (const rule of parseRules(file.source)) {
            for (const match of rule.selector.matchAll(CLASS_NAME_PATTERN)) {
                const className = match[1];
                const dynamic = dynamicNames.includes(className)
                    || dynamicPrefixes.some((prefix) => className.startsWith(prefix));
                if (!dynamic && !hasModuleReference(importers.get(file.relativePath) || [], className)) {
                    orphaned.push(`${file.relativePath}: .${className}`);
                }
            }
        }
    }

    expect([...new Set(orphaned)]).toEqual([]);
});
